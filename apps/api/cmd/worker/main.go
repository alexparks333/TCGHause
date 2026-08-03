// Command worker runs scheduled/background jobs. Auction close (this file)
// is the first one wired up: escrow release checks and seller-tier
// recomputation (CLAUDE.md §5.4) are still unbuilt — internal/escrow and
// internal/seller are doc-only stubs, nothing to schedule yet.
package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"auctionhous-tcg/api/internal/auction"
	"auctionhous-tcg/api/internal/platform"
)

// closeInterval is how often the worker checks for ended auctions. There's
// no soft-close (CLAUDE.md §6.1), so there's no benefit to polling faster
// than a buyer would notice — this just bounds how long an auction can sit
// "ended but not yet marked ended" after its clock runs out.
const closeInterval = 15 * time.Second

func main() {
	// Best-effort, same as cmd/api: a real deployment sets env vars
	// directly and has no .env file, which is fine.
	_ = godotenv.Load()

	cfg, err := platform.LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := platform.NewPgxPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	log.Printf("worker: starting, closing ended auctions every %s", closeInterval)
	runCloseLoop(ctx, pool)
	log.Println("worker: shutting down")
}

// runCloseLoop ticks CloseEndedAuctions on a fixed interval until ctx is
// cancelled (SIGINT/SIGTERM). Runs one pass immediately on startup rather
// than waiting for the first tick, so auctions that ended while the worker
// was down (or before it was ever deployed) get closed right away instead
// of sitting stale for up to a full interval.
func runCloseLoop(ctx context.Context, pool *pgxpool.Pool) {
	closeOnce(ctx, pool)

	ticker := time.NewTicker(closeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			closeOnce(ctx, pool)
		}
	}
}

func closeOnce(ctx context.Context, pool *pgxpool.Pool) {
	results, err := auction.CloseEndedAuctions(ctx, pool)
	if err != nil {
		log.Printf("worker: close pass failed: %v", err)
		return
	}
	closed := 0
	for _, r := range results {
		if r.Err != nil {
			log.Printf("worker: failed to close auction %s: %v", r.ListingID, r.Err)
			continue
		}
		closed++
		switch r.Outcome {
		case "sold":
			log.Printf("worker: auction %s closed — sold to %s for %d cents (%d bids)",
				r.ListingID, *r.HighBidderID, r.FinalPriceCents, r.BidCount)
		case "no_bids":
			log.Printf("worker: auction %s closed — no bids", r.ListingID)
		}
	}
	if closed > 0 {
		log.Printf("worker: closed %d auction(s)", closed)
	}
}
