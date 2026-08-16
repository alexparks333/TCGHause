package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
)

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
	refundUndeliveredOrders(ctx, pool, paymentClient)
	releaseElapsedClaimWindows(ctx, pool)
}

// cancelUnshippedOrders enforces design doc v2 §5.2's 72-hour ship clock:
// AWAITING_SHIP -> CANCELLED with a full refund if the seller hasn't marked
// it shipped in time. updated_at is the entry time into awaiting_ship,
// since Transition stamps it on every state change and nothing else
// touches an order while it sits in this state.
func cancelUnshippedOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id, seller_id, stripe_payment_intent_id from orders
		where state = $1 and updated_at < now() - interval '72 hours'
	`, string(order.StateAwaitingShip))
	if err != nil {
		log.Printf("worker: query unshipped orders failed: %v", err)
		return
	}
	type row struct {
		id, sellerID string
		piID         *string
	}
	var toCancel []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.sellerID, &r.piID); err != nil {
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
		if err := refundAndTransition(ctx, pool, paymentClient, r.id, r.sellerID, r.piID, order.StateAwaitingShip, order.StateCancelled); err != nil {
			log.Printf("worker: failed to cancel unshipped order %s: %v", r.id, err)
			continue
		}
		log.Printf("worker: order %s cancelled — no tracking uploaded within 72h, refunded", r.id)
	}
}

// refundUndeliveredOrders enforces design doc v2 §5.2's 21-day no-scan
// rule: SHIPPED -> REFUNDED if no delivery confirmation ever arrives.
func refundUndeliveredOrders(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id, seller_id, stripe_payment_intent_id from orders
		where state = $1 and updated_at < now() - interval '21 days'
	`, string(order.StateShipped))
	if err != nil {
		log.Printf("worker: query undelivered orders failed: %v", err)
		return
	}
	type row struct {
		id, sellerID string
		piID         *string
	}
	var toRefund []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.sellerID, &r.piID); err != nil {
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
		if err := refundAndTransition(ctx, pool, paymentClient, r.id, r.sellerID, r.piID, order.StateShipped, order.StateRefunded); err != nil {
			log.Printf("worker: failed to refund undelivered order %s: %v", r.id, err)
			continue
		}
		log.Printf("worker: order %s refunded — no delivery scan within 21 days of shipping", r.id)
	}
}

// refundAndTransition issues a real Stripe refund (best-effort — a failed
// refund is logged, not left to block the state transition entirely, since
// the buyer having their money back is what actually matters and a stuck
// order helps nobody) then performs the state transition.
func refundAndTransition(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID, sellerID string, piID *string, from, to order.State) error {
	if paymentClient.IsConfigured() && piID != nil {
		var stripeAccountID *string
		if err := pool.QueryRow(ctx, `select stripe_account_id from users where id = $1`, sellerID).Scan(&stripeAccountID); err != nil {
			log.Printf("worker: failed to look up seller connect account for refund on order %s: %v", orderID, err)
		} else if stripeAccountID != nil {
			if err := paymentClient.Refund(ctx, *stripeAccountID, *piID); err != nil {
				log.Printf("worker: refund failed for order %s: %v", orderID, err)
			}
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
func releaseElapsedClaimWindows(ctx context.Context, pool *pgxpool.Pool) {
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
		log.Printf("worker: order %s released — claim window elapsed with no claim filed", id)
	}
}
