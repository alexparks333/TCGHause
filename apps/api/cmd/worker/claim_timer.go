package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/dispute"
	"auctionhous-tcg/api/internal/payment"
)

// claimTimerInterval doesn't need to be fine-grained — a 48-hour
// negotiation window drifting by a few minutes is invisible to anyone.
const claimTimerInterval = 15 * time.Minute

func runClaimTimerLoop(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	claimTimerOnce(ctx, pool, paymentClient)

	ticker := time.NewTicker(claimTimerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			claimTimerOnce(ctx, pool, paymentClient)
		}
	}
}

// claimTimerOnce auto-escalates any claim that's sat in direct negotiation
// for 48 hours with no resolution (design doc v2 §9.1's first rung —
// "most issues die here," but the ones that don't need to keep moving
// rather than sit open forever).
func claimTimerOnce(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client) {
	rows, err := pool.Query(ctx, `
		select id from claims
		where state = $1 and created_at < now() - interval '48 hours'
	`, string(dispute.StateNegotiating))
	if err != nil {
		log.Printf("worker: query stale negotiating claims failed: %v", err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("worker: scan stale claim failed: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("worker: query stale negotiating claims failed: %v", err)
		return
	}

	for _, id := range ids {
		if err := dispute.Escalate(ctx, pool, paymentClient, id); err != nil {
			log.Printf("worker: failed to auto-escalate claim %s: %v", id, err)
			continue
		}
		log.Printf("worker: claim %s auto-escalated after 48h with no resolution", id)
	}
}
