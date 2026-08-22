package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/dispute"
	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/payment"
)

// claimTimerInterval doesn't need to be fine-grained — a 48-hour
// negotiation window drifting by a few minutes is invisible to anyone.
const claimTimerInterval = 15 * time.Minute

func runClaimTimerLoop(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) {
	claimTimerOnce(ctx, pool, paymentClient, mailClient, webOrigin)

	ticker := time.NewTicker(claimTimerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			claimTimerOnce(ctx, pool, paymentClient, mailClient, webOrigin)
		}
	}
}

// claimTimerOnce auto-escalates any claim that's sat in direct negotiation
// for 48 hours with no resolution (design doc v2 §9.1's first rung —
// "most issues die here," but the ones that don't need to keep moving
// rather than sit open forever). This is the real path that lands a claim
// in human_review in production — a human rarely clicks "escalate" faster
// than the timer does — so it's also the real path that fires the
// support@ notification email (internal/dispute.notifyHumanReview).
func claimTimerOnce(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) {
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
		if err := dispute.Escalate(ctx, pool, paymentClient, mailClient, webOrigin, id); err != nil {
			log.Printf("worker: failed to auto-escalate claim %s: %v", id, err)
			continue
		}
		log.Printf("worker: claim %s auto-escalated after 48h with no resolution", id)
	}
}
