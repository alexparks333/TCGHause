package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/chargeback"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/shipping"
)

// letterShipmentAssumedDeliveryDays is how long a tracked_envelope/
// free_envelope order sits in "shipped" before this worker assumes it
// arrived. Pitney Bowes' IMb tracking (internal/shipping's package doc)
// only proves the mailpiece entered USPS's system — it structurally never
// produces a delivery scan the way a Shippo package does, so
// refundUndeliveredOrders' 21-day no-scan-means-refund rule would
// incorrectly refund every single envelope shipment a few weeks in.
// First-Class Mail typically delivers within a few business days; 7
// calendar days is a deliberately generous buffer before assuming
// delivery, matching the original PWE concept's timer from before this
// feature existed.
const letterShipmentAssumedDeliveryDays = 7

// orderTimerInterval doesn't need auction-close's 2-second cadence — none
// of these deadlines are latency-sensitive to the minute, let alone the
// second. A minute is frequent enough that a 72-hour or 3-day deadline
// never drifts by anything a user would notice.
const orderTimerInterval = 1 * time.Minute

// runOrderTimersLoop ticks every order-lifecycle timer pass on a fixed
// interval until ctx is cancelled — same immediate-first-pass-then-ticker
// shape as runCloseLoop, so orders whose deadline already passed while the
// worker was down get handled right away instead of waiting a full interval.
func runOrderTimersLoop(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	orderTimersOnce(ctx, pool, paymentClient)

	ticker := time.NewTicker(orderTimerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			orderTimersOnce(ctx, pool, paymentClient)
		}
	}
}

func orderTimersOnce(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	cancelUnshippedOrders(ctx, pool, paymentClient)
	assumeDeliveredForLetterShipments(ctx, pool, paymentClient)
	refundUndeliveredOrders(ctx, pool, paymentClient)
	releaseElapsedClaimWindows(ctx, pool, paymentClient)
}

// cancelUnshippedOrders enforces design doc v2 §5.2's 72-hour ship clock:
// AWAITING_SHIP -> CANCELLED with a full refund if the seller hasn't marked
// it shipped in time. updated_at is the entry time into awaiting_ship,
// since Transition stamps it on every state change and nothing else
// touches an order while it sits in this state.
func cancelUnshippedOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id, stripe_payment_intent_id from orders
		where state = $1 and updated_at < now() - interval '72 hours'
	`, string(order.StateAwaitingShip))
	if err != nil {
		log.Printf("worker: query unshipped orders failed: %v", err)
		return
	}
	type row struct {
		id   string
		piID *string
	}
	var toCancel []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.piID); err != nil {
			rows.Close()
			log.Printf("worker: scan unshipped order failed: %v", err)
			return
		}
		toCancel = append(toCancel, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query unshipped orders failed: %v", err)
		return
	}

	for _, r := range toCancel {
		if err := refundAndTransition(ctx, pool, paymentClient, r.id, r.piID, order.StateAwaitingShip, order.StateCancelled); err != nil {
			log.Printf("worker: failed to cancel unshipped order %s: %v", r.id, err)
			continue
		}
		log.Printf("worker: order %s cancelled — no tracking uploaded within 72h, refunded", r.id)
	}
}

// assumeDeliveredForLetterShipments is the letter-mechanism equivalent of a
// carrier "delivered" webhook: Pitney Bowes' IMb tracking only proves the
// mailpiece entered USPS's system, never that it actually reached the
// buyer, so nothing will ever call order.MarkDelivered for these orders
// the way internal/shipping's webhook does for Shippo packages. After
// letterShipmentAssumedDeliveryDays with no other event, this worker
// assumes delivery happened and calls MarkDelivered itself — which still
// runs the normal claim-window/trusted-release logic from there, so a
// buyer's dispute protection isn't shortened just because the shipping
// method is cheaper.
func assumeDeliveredForLetterShipments(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id from orders
		where state = $1 and shipping_preset in ($2, $3)
			and updated_at < now() - interval '1 day' * $4
	`, string(order.StateShipped), string(shipping.PresetTrackedEnvelope), string(shipping.PresetFreeEnvelope), letterShipmentAssumedDeliveryDays)
	if err != nil {
		log.Printf("worker: query undelivered letter shipments failed: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("worker: scan undelivered letter shipment failed: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query undelivered letter shipments failed: %v", err)
		return
	}

	for _, id := range ids {
		if err := order.MarkDelivered(ctx, pool, paymentClient, id); err != nil {
			log.Printf("worker: failed to mark letter shipment %s delivered: %v", id, err)
			continue
		}
		log.Printf("worker: order %s assumed delivered — %d days elapsed on a tracked-envelope shipment with no further event", id, letterShipmentAssumedDeliveryDays)
	}
}

// refundUndeliveredOrders enforces design doc v2 §5.2's 21-day no-scan
// rule: SHIPPED -> REFUNDED if no delivery confirmation ever arrives.
// Package-mechanism orders only (shippo_ground_advantage/free_bubble_mailer/
// free_box, or null for orders that predate the preset feature entirely) —
// letter-mechanism orders (tracked_envelope/free_envelope) never get a real
// delivery scan by design, so "no scan after 21 days" would mean nothing
// for them; assumeDeliveredForLetterShipments handles those instead, on a
// much shorter, non-refunding timer.
func refundUndeliveredOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id, stripe_payment_intent_id from orders
		where state = $1 and updated_at < now() - interval '21 days'
			and (shipping_preset is null or shipping_preset not in ('tracked_envelope', 'free_envelope'))
	`, string(order.StateShipped))
	if err != nil {
		log.Printf("worker: query undelivered orders failed: %v", err)
		return
	}
	type row struct {
		id   string
		piID *string
	}
	var toRefund []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.piID); err != nil {
			rows.Close()
			log.Printf("worker: scan undelivered order failed: %v", err)
			return
		}
		toRefund = append(toRefund, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query undelivered orders failed: %v", err)
		return
	}

	for _, r := range toRefund {
		if err := refundAndTransition(ctx, pool, paymentClient, r.id, r.piID, order.StateShipped, order.StateRefunded); err != nil {
			log.Printf("worker: failed to refund undelivered order %s: %v", r.id, err)
			continue
		}
		log.Printf("worker: order %s refunded — no delivery scan within 21 days of shipping", r.id)
	}
}

// refundAndTransition issues a real Stripe refund (best-effort — a failed
// refund is logged, not left to block the state transition entirely, since
// the buyer having their money back is what actually matters and a stuck
// order helps nobody) then performs the state transition. No seller
// Connect lookup needed anymore — separate charges and transfers
// (docs/Legal_MoneyTransitter.md) means the charge being refunded always
// lives on the platform's own Stripe account, regardless of the seller's
// Connect state.
func refundAndTransition(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string, piID *string, from, to order.State) error {
	if paymentClient.IsConfigured() && piID != nil {
		if err := paymentClient.Refund(ctx, *piID); err != nil {
			log.Printf("worker: refund failed for order %s: %v", orderID, err)
		}
	}
	return order.Transition(ctx, pool, orderID, from, to)
}

// releaseElapsedClaimWindows enforces design doc v2 §5.2's claim-window
// timer: CLAIM_WINDOW -> RELEASED once claim_deadline has passed (3 or 7
// days, set by order.MarkDelivered based on order value) with no claim
// filed. A buyer who files a claim first moves the order to CLAIM_OPEN
// (internal/dispute, Phase 8 — not built yet) before this timer would ever
// fire, so this query never needs to check for an open claim itself.
func releaseElapsedClaimWindows(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id from orders
		where state = $1 and claim_deadline is not null and claim_deadline < now()
	`, string(order.StateClaimWindow))
	if err != nil {
		log.Printf("worker: query elapsed claim windows failed: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("worker: scan elapsed claim window failed: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query elapsed claim windows failed: %v", err)
		return
	}

	for _, id := range ids {
		if err := order.Transition(ctx, pool, id, order.StateClaimWindow, order.StateReleased); err != nil {
			log.Printf("worker: failed to release order %s: %v", id, err)
			continue
		}
		if _, err := pool.Exec(ctx, `update orders set released_at = now() where id = $1`, id); err != nil {
			log.Printf("worker: failed to stamp released_at for order %s: %v", id, err)
		}

		// Same guard as internal/dispute's releaseOrder: a real chargeback
		// can arrive independent of anything the claim-window timer knows
		// about, and must stop this order from paying out regardless.
		if blocked, err := chargeback.HasBlockingChargeback(ctx, pool, id); err != nil {
			log.Printf("worker: failed to check chargeback status for order %s: %v", id, err)
		} else if blocked {
			log.Printf("worker: order %s has a pending or lost chargeback — withholding seller payout", id)
			continue
		}

		if err := order.ReleaseFunds(ctx, pool, paymentClient, id); err != nil {
			log.Printf("worker: failed to release funds for order %s: %v", id, err)
		}
		log.Printf("worker: order %s released — claim window elapsed with no claim filed", id)
	}
}
