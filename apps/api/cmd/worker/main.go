// Command worker runs scheduled/background jobs: auction close, the
// order-lifecycle timers from design doc v2 §5.2 (order_timers.go), seller-
// tier recomputation (tier_recompute.go, design doc v2 §3, CLAUDE.md §5.4),
// and claim auto-escalation (claim_timer.go, design doc v2 §9.1).
//
// Deliberately NOT here: payout batching. It used to run on a timer
// (payout_timer.go, removed) that swept every RELEASED order out to the
// seller's bank automatically — but that silently defeated the whole
// point of the Withdraw page's paid Instant option (internal/payout.
// TriggerInstantPayout): if funds got auto-paid-out the instant they
// were released, a seller could never actually choose to pay for speed,
// since the free path had already fired first. Every payout on this
// platform is now a direct, seller-initiated click (Standard or Instant,
// see internal/payout.TriggerStandardPayout/TriggerInstantPayout) — no
// background sweep exists that could race ahead of that choice.
package main

import (
	"context"
	"log"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"auctionhous-tcg/api/internal/auction"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

// closeInterval is how often the worker checks for ended auctions. This is
// the actual bottleneck for "how fast does the winner get decided" — the
// win/sale celebration (internal/auction/celebration.go) can't exist until
// outcome = 'sold' is set, which only happens here. The query itself is a
// cheap indexed lookup (auctions_pending_close_idx), so there's no real
// cost to polling this often even at production scale.
const closeInterval = 2 * time.Second

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

	paymentClient := payment.NewClient(cfg.StripeSecretKey)

	log.Printf("worker: starting, closing ended auctions every %s, order timers every %s, tier recompute every %s, claim timers every %s",
		closeInterval, orderTimerInterval, tierRecomputeInterval, claimTimerInterval)

	// All four loops run concurrently and block until ctx is cancelled — a
	// sync.WaitGroup (not just spawning them as bare goroutines) so main()
	// doesn't return, and defer pool.Close() above doesn't fire, until all
	// four have actually finished shutting down.
	var wg sync.WaitGroup
	wg.Add(4)
	go func() {
		defer wg.Done()
		runCloseLoop(ctx, pool)
	}()
	go func() {
		defer wg.Done()
		runOrderTimersLoop(ctx, pool, paymentClient)
	}()
	go func() {
		defer wg.Done()
		runTierRecomputeLoop(ctx, pool)
	}()
	go func() {
		defer wg.Done()
		runClaimTimerLoop(ctx, pool, paymentClient)
	}()
	wg.Wait()

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
