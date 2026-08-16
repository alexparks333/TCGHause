package main

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/seller"
)

// tierRecomputeInterval is daily, not one of the fast-polling intervals
// elsewhere in this file — tier promotion/demotion (design doc v2 §3,
// CLAUDE.md §5.4) is not latency-sensitive the way auction close or a
// payment timeout is; a seller crossing a threshold seeing it reflected
// within a day is the same cadence eBay's own monthly seller-standards
// re-evaluation implies, just tighter.
const tierRecomputeInterval = 24 * time.Hour

func runTierRecomputeLoop(ctx context.Context, pool *pgxpool.Pool) {
	tierRecomputeOnce(ctx, pool)

	ticker := time.NewTicker(tierRecomputeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tierRecomputeOnce(ctx, pool)
		}
	}
}

func tierRecomputeOnce(ctx context.Context, pool *pgxpool.Pool) {
	changes, errs := seller.RecomputeAllTiers(ctx, pool)
	for _, err := range errs {
		log.Printf("worker: tier recompute failed: %v", err)
	}
	for _, c := range changes {
		log.Printf("worker: seller %s tier %s -> %s (%s)", c.SellerID, c.From, c.To, c.Reason)
	}
}
