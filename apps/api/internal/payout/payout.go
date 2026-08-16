package payout

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
)

// InstantPayoutFeePct is design doc v2 §6.3's paid instant-payout upsell:
// Stripe charges the platform 1.5% for an instant payout; we sell it to
// the seller at 2%. See TriggerInstantPayout's doc comment for exactly
// how (and how imperfectly) that spread is realized today.
const InstantPayoutFeePct = 0.02

// TriggerStandardPayout pays out ALL of sellerID's currently released
// orders via Stripe's ordinary (free, ~1-2 business day) payout speed —
// the "Standard Transfer" button on the Withdraw page.
//
// Deliberately seller-initiated only, with no automatic timer anywhere
// behind it. An earlier version of this ran on a fixed interval in
// cmd/worker (payout_timer.go, since deleted) and swept every RELEASED
// order out to the seller's bank automatically — which quietly broke the
// entire point of TriggerInstantPayout's "pay 2% to skip the wait"
// upsell: if funds get auto-paid-out the moment they're released, there's
// never a window where a seller could actually choose to pay for speed,
// because the free path already fired first. "Available to withdraw" on
// the Withdraw page must mean exactly that — available, sitting there,
// waiting for the seller to actively pick Standard or Instant — never
// "about to be swept out on its own." See TASKS-TODO.md.
func TriggerStandardPayout(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, sellerID string) (string, error) {
	if !paymentClient.IsConfigured() {
		return "", fmt.Errorf("payments are not configured")
	}
	return payoutForSeller(ctx, pool, paymentClient, sellerID, "standard", 0, "")
}

// TriggerInstantPayout immediately pays out ALL of sellerID's currently
// released orders — design doc v2 §6.3's paid upsell for a seller who
// doesn't want to wait Standard's ~1-2 business days.
//
// Known simplification, flagged rather than silently assumed correct:
// this charges the advertised 2% by paying the seller 98% of what they're
// owed — Stripe's own ~1.5% instant-payout cost comes out of that same
// reduction (Stripe deducts its fee from the payout amount automatically
// for Instant Payouts), and the remaining ~0.5% margin simply isn't paid
// out — it stays in the seller's Stripe balance rather than being swept
// to a distinct, tracked platform-revenue destination. There's no
// application-fee-like mechanism on a bare Payouts API call the way there
// is on a charge, so cleanly recognizing that spread as platform revenue
// needs either a separate small transfer/charge or Stripe Treasury-level
// bookkeeping — real follow-up work, not attempted here. The seller-facing
// price (98% of what they'd otherwise get, right now instead of Standard)
// is correctly charged either way.
func TriggerInstantPayout(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, sellerID string) (string, error) {
	if !paymentClient.IsConfigured() {
		return "", fmt.Errorf("payments are not configured")
	}
	return payoutForSeller(ctx, pool, paymentClient, sellerID, "instant", InstantPayoutFeePct, "instant")
}

// payoutForSeller creates one payouts row, links every one of sellerID's
// currently-released orders to it, and calls Stripe — the shared
// implementation behind both TriggerStandardPayout and
// TriggerInstantPayout, always triggered by an explicit seller click on
// the Withdraw page, never a background sweep. The DB linkage happens
// BEFORE the Stripe call (same reasoning as order creation in
// internal/order.CreateFromWin: this codebase's convention is that once
// the domain fact is decided — here, "these orders belong to this payout"
// — recording it doesn't wait on an external API call that could itself
// fail or be slow) — if CreatePayout then fails, the payout row is left
// in 'pending' status rather than rolled back, so a retry pass can see
// exactly which payout needs to be re-attempted instead of
// re-discovering the same orders as unpaid-out and double-counting them.
// feePct (0 for Standard) reduces the actual amount paid out — see
// TriggerInstantPayout's doc comment for why.
func payoutForSeller(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, sellerID, kind string, feePct float64, method string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		select id, seller_net_cents from orders
		where seller_id = $1 and state = 'released' and payout_id is null
		for update
	`, sellerID)
	if err != nil {
		return "", fmt.Errorf("query seller's released orders: %w", err)
	}
	var orderIDs []string
	var amountCents int64
	for rows.Next() {
		var id string
		var netCents int64
		if err := rows.Scan(&id, &netCents); err != nil {
			rows.Close()
			return "", fmt.Errorf("scan released order: %w", err)
		}
		orderIDs = append(orderIDs, id)
		amountCents += netCents
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return "", err
	}
	rows.Close()

	if len(orderIDs) == 0 || amountCents <= 0 {
		return "", nil
	}

	payoutAmountCents := amountCents
	if feePct > 0 {
		payoutAmountCents = int64(math.Round(float64(amountCents) * (1 - feePct)))
	}

	var stripeAccountID *string
	if err := tx.QueryRow(ctx, `select stripe_account_id from users where id = $1`, sellerID).Scan(&stripeAccountID); err != nil {
		return "", fmt.Errorf("read seller connect account: %w", err)
	}
	if stripeAccountID == nil {
		// A released order for a seller with no Connect account shouldn't
		// be possible (checkout is gated on connect_charges_enabled), but
		// fail safe rather than panic on a nil deref if it somehow happens.
		return "", fmt.Errorf("seller %s has no stripe_account_id", sellerID)
	}

	var payoutID string
	if err := tx.QueryRow(ctx, `
		insert into payouts (seller_id, amount_cents, status, kind) values ($1, $2, 'pending', $3)
		returning id
	`, sellerID, payoutAmountCents, kind).Scan(&payoutID); err != nil {
		return "", fmt.Errorf("insert payout: %w", err)
	}

	for _, orderID := range orderIDs {
		if _, err := tx.Exec(ctx, `insert into payout_orders (payout_id, order_id) values ($1, $2)`, payoutID, orderID); err != nil {
			return "", fmt.Errorf("insert payout_orders: %w", err)
		}
		if _, err := tx.Exec(ctx, `update orders set payout_id = $1 where id = $2`, payoutID, orderID); err != nil {
			return "", fmt.Errorf("update order payout_id: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}

	sp, err := paymentClient.CreatePayout(ctx, *stripeAccountID, payoutAmountCents, method)
	if err != nil {
		// The batch linkage above already committed — leave the payout
		// row as 'pending' with no stripe_payout_id; a future pass or a
		// manual retry can pick it back up by stripe_payout_id being null,
		// without re-querying "unbatched released orders" (they're already
		// attached to this payout row, so they won't show up as unbatched
		// again and get double-counted into a second batch).
		return payoutID, fmt.Errorf("stripe payout call failed for already-committed batch %s: %w", payoutID, err)
	}

	if _, err := pool.Exec(ctx, `
		update payouts set stripe_payout_id = $1, status = 'in_transit' where id = $2
	`, sp.ID, payoutID); err != nil {
		return payoutID, fmt.Errorf("record stripe payout id: %w", err)
	}

	return payoutID, nil
}

// Summary is the Withdraw page's headline numbers — the wallet balance and
// the greyed-out "coming, not yet claimable" figure next to it.
type Summary struct {
	// AvailableCents is exactly what TriggerInstantPayout/the next batch
	// would pay out right now: every RELEASED order not yet attached to a
	// payout (same set payoutForSeller's query operates on, read-only
	// here — see BatchReleasedOrders' doc comment for why "released" is
	// the only state a payout ever touches).
	AvailableCents int64
	// PendingCents is every order the buyer has genuinely paid for but
	// that hasn't reached RELEASED yet, for any reason — not yet shipped,
	// in transit, delivered but still inside its claim_window (design doc
	// v2 §5.2's 3/7-day buyer-protection delay), or under an open claim's
	// review. All of it is real money already sitting in the seller's own
	// Stripe balance (direct charges land it there the instant a charge
	// captures — CLAUDE.md §5.1/§7), just not yet eligible for a payout.
	// Deliberately excludes `payment_pending` (an ACH debit still in
	// flight — hasn't actually landed anywhere yet, and can still bounce)
	// and both terminal states (`refunded`, `cancelled` — money that was
	// never going to reach the seller at all).
	PendingCents int64
}

// pendingStates is every non-terminal order state after a charge has
// genuinely captured but before RELEASED — see PendingCents' doc comment.
var pendingStates = []string{"paid", "awaiting_ship", "shipped", "delivered", "claim_window", "claim_open"}

// GetSummary computes sellerID's current wallet state — two aggregate
// reads, no locking needed since nothing here mutates anything (contrast
// payoutForSeller's `for update` row lock, which exists because THAT path
// commits a real payout batch).
func GetSummary(ctx context.Context, pool *pgxpool.Pool, sellerID string) (Summary, error) {
	var s Summary
	if err := pool.QueryRow(ctx, `
		select coalesce(sum(seller_net_cents), 0) from orders
		where seller_id = $1 and state = 'released' and payout_id is null
	`, sellerID).Scan(&s.AvailableCents); err != nil {
		return Summary{}, fmt.Errorf("sum available orders: %w", err)
	}
	if err := pool.QueryRow(ctx, `
		select coalesce(sum(seller_net_cents), 0) from orders
		where seller_id = $1 and state = any($2)
	`, sellerID, pendingStates).Scan(&s.PendingCents); err != nil {
		return Summary{}, fmt.Errorf("sum pending orders: %w", err)
	}
	return s, nil
}

// Record is one row of the Withdraw page's payout history list.
type Record struct {
	ID          string     `json:"id"`
	AmountCents int64      `json:"amountCents"`
	Status      string     `json:"status"`
	Kind        string     `json:"kind"`
	CreatedAt   time.Time  `json:"createdAt"`
	PaidAt      *time.Time `json:"paidAt,omitempty"`
}

// ListRecent returns sellerID's most recent payouts, newest first — every
// field already lives on the payouts row itself (amount_cents is the
// total actually sent, not something to re-derive from payout_orders).
func ListRecent(ctx context.Context, pool *pgxpool.Pool, sellerID string, limit int) ([]Record, error) {
	rows, err := pool.Query(ctx, `
		select id, amount_cents, status, kind, created_at, paid_at
		from payouts where seller_id = $1
		order by created_at desc
		limit $2
	`, sellerID, limit)
	if err != nil {
		return nil, fmt.Errorf("query payouts: %w", err)
	}
	defer rows.Close()

	out := []Record{}
	for rows.Next() {
		var r Record
		if err := rows.Scan(&r.ID, &r.AmountCents, &r.Status, &r.Kind, &r.CreatedAt, &r.PaidAt); err != nil {
			return nil, fmt.Errorf("scan payout: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
