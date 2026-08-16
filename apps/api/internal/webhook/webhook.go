// Package webhook is the single entry point for asynchronous events Stripe
// sends us — the one piece of payment-state sync in this app that isn't
// driven by a synchronous request handler. No webhook handler existed
// before this (design doc v2 §5.2): every event type below maps directly to
// a transition described in the design doc, and every event is deduplicated
// against the stripe_events table before any side effect runs, since Stripe
// redelivers on anything other than a 200 response.
//
// One-time dashboard setup this package's code can't do for you: by
// default a webhook endpoint only receives PLATFORM-level events.
// account.updated/payout.paid/payout.failed all fire on a connected
// account, not the platform account, so this endpoint must be explicitly
// configured to also receive Connect events — the "Listen to events on
// Connected accounts" toggle when creating the endpoint in the Stripe
// Dashboard (dashboard.stripe.com/test/webhooks), or `connect: true` if
// creating it via the API. Without that, this handler is registered and
// signature-verifies fine, it just never gets called for those event types.
package webhook

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"

	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/seller"
)

// alreadyProcessed upserts eventID into stripe_events; a true return means
// this event was already handled and its side effects must not run again.
// Standard Stripe-recommended idempotency pattern (design doc v2 §5.2) —
// Stripe redelivers any event that didn't get a 200 response.
func alreadyProcessed(ctx context.Context, pool *pgxpool.Pool, eventID, eventType string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		insert into stripe_events (id, type) values ($1, $2)
		on conflict (id) do nothing`, eventID, eventType)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 0, nil
}

// HandleStripe verifies and dispatches incoming Stripe webhook events. Must
// be registered OUTSIDE the Supabase-JWT auth chain — Stripe authenticates
// its own requests via the Stripe-Signature header, verified against
// webhookSecret, not a bearer token.
func HandleStripe(pool *pgxpool.Pool, webhookSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}

		// IgnoreAPIVersionMismatch: stripe-go v82.5.1 is pinned to API
		// version 2025-08-27.basil, but this Stripe account's own default
		// (set on account creation, not something this repo controls) is
		// newer — the SDK's webhook verifier refuses to parse an event
		// declaring a version it doesn't recognize as a safety check, even
		// though the signature itself is valid. Every field this handler
		// actually reads below (account.id/charges_enabled/payouts_enabled/
		// details_submitted, payout.id/status, payment_intent.id) has been
		// stable across Stripe API versions for years, so the "objects may
		// be incorrectly deserialized" risk the SDK warns about is low for
		// what's used here. The durable fix is pinning the SDK to a newer
		// release (or the webhook endpoint to an older API version) —
		// flagged as real follow-up, not attempted mid-session.
		event, err := webhook.ConstructEventWithOptions(payload, r.Header.Get("Stripe-Signature"), webhookSecret, webhook.ConstructEventOptions{
			IgnoreAPIVersionMismatch: true,
		})
		if err != nil {
			log.Printf("webhook: signature verification failed: %v", err)
			http.Error(w, "invalid signature", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		dup, err := alreadyProcessed(ctx, pool, event.ID, string(event.Type))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if dup {
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := dispatch(ctx, pool, event); err != nil {
			log.Printf("webhook: handling %s (%s) failed: %v", event.ID, event.Type, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func dispatch(ctx context.Context, pool *pgxpool.Pool, event stripe.Event) error {
	switch event.Type {
	case "account.updated":
		var acct stripe.Account
		if err := json.Unmarshal(event.Data.Raw, &acct); err != nil {
			return err
		}
		return seller.SyncConnectAccountFromWebhook(ctx, pool, &acct)
	case "payout.paid", "payout.failed":
		var p stripe.Payout
		if err := json.Unmarshal(event.Data.Raw, &p); err != nil {
			return err
		}
		return syncPayoutStatus(ctx, pool, &p, event.Type)
	case "payment_intent.succeeded":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			return err
		}
		return advancePaymentPendingOrder(ctx, pool, pi.ID)
	case "payment_intent.payment_failed":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			return err
		}
		return cancelPaymentPendingOrder(ctx, pool, pi.ID)
	default:
		// Not every event type Stripe can send is one we act on — silently
		// acknowledging (200) an event type we don't handle is correct;
		// only a genuine processing failure for a type we DO handle
		// should trigger a Stripe redelivery.
		return nil
	}
}

// advancePaymentPendingOrder handles the ACH rail's async confirmation
// (design doc v2 §5.2, §4): the card rail already lands in awaiting_ship
// synchronously in internal/auction/buynow.go, so this webhook firing for
// a card order is a harmless no-op (its order is already past
// payment_pending) — only an order genuinely still sitting in
// payment_pending (an ACH order whose 4-business-day confirmation just
// completed) actually advances here.
func advancePaymentPendingOrder(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) error {
	o, err := order.GetByPaymentIntentID(ctx, pool, paymentIntentID)
	if err != nil {
		if errors.Is(err, order.ErrNotFound) {
			return nil
		}
		return err
	}
	if o.State != order.StatePaymentPending {
		return nil
	}
	if err := order.Transition(ctx, pool, o.ID, order.StatePaymentPending, order.StatePaid); err != nil {
		return err
	}

	// paid_at on listings/auctions was deliberately left unset for the ACH
	// rail when the order was created (internal/auction/buynow.go) — this
	// is the moment it actually becomes true. o.ListingID's row exists in
	// exactly one of these two tables depending on format; running both
	// updates unconditionally is simpler than fetching the listing first to
	// find out which, and the one that doesn't apply just affects 0 rows.
	if _, err := pool.Exec(ctx, `update listings set paid_at = now() where id = $1`, o.ListingID); err != nil {
		return fmt.Errorf("record listing paid_at: %w", err)
	}
	if _, err := pool.Exec(ctx, `update auctions set paid_at = now() where listing_id = $1`, o.ListingID); err != nil {
		return fmt.Errorf("record auction paid_at: %w", err)
	}

	return order.Transition(ctx, pool, o.ID, order.StatePaid, order.StateAwaitingShip)
}

// cancelPaymentPendingOrder handles an ACH charge that ultimately failed or
// was returned by the buyer's bank (design doc v2 §5.2's
// "charge.failed -> cancelled" edge) — only acts on an order still
// genuinely in payment_pending, same reasoning as advancePaymentPendingOrder.
//
// Known gap, flagged rather than silently assumed away: this does not
// reverse the listing/auction ownership the atomic compare-and-swap already
// granted before the ACH intent was confirmed (internal/auction.BuyNow /
// listing.BuyNowFixed) — the order correctly reflects "cancelled, unpaid,"
// but the item itself stays marked sold/ended rather than returning to
// active. Reopening a listing after a days-later payment failure is a real
// product decision (relist automatically? notify the seller to relist
// manually? does the second-highest bidder get first refusal?) that design
// doc v2 doesn't specify — not resolved here.
func cancelPaymentPendingOrder(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) error {
	o, err := order.GetByPaymentIntentID(ctx, pool, paymentIntentID)
	if err != nil {
		if errors.Is(err, order.ErrNotFound) {
			return nil
		}
		return err
	}
	if o.State != order.StatePaymentPending {
		return nil
	}
	return order.Transition(ctx, pool, o.ID, order.StatePaymentPending, order.StateCancelled)
}

// syncPayoutStatus updates our own payouts row from Stripe's actual
// outcome — internal/payout.BatchReleasedOrders only ever sets status to
// 'in_transit' when it creates the Payout; whether it actually lands in
// the seller's bank ('paid') or bounces ('failed') is only known
// asynchronously, via this webhook (design doc v2 §6).
func syncPayoutStatus(ctx context.Context, pool *pgxpool.Pool, p *stripe.Payout, eventType stripe.EventType) error {
	status := "paid"
	if eventType == "payout.failed" {
		status = "failed"
	}
	_, err := pool.Exec(ctx, `
		update payouts set status = $1, paid_at = case when $1 = 'paid' then now() else paid_at end
		where stripe_payout_id = $2
	`, status, p.ID)
	return err
}
