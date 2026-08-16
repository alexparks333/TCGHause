package auction

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/notification"
)

// CloseResult is one auction CloseEndedAuctions actually touched this pass.
// If Err is set, closing that one auction failed and every other field is
// meaningless — the caller (cmd/worker) is expected to log Err and move on,
// since one bad row must never block every other ended auction from
// closing.
type CloseResult struct {
	ListingID       string
	Outcome         string // "sold" | "no_bids"
	HighBidderID    *string
	FinalPriceCents int64
	BidCount        int32
	Err             error
}

// CloseEndedAuctions finds every auction whose clock has run out but that
// hasn't been closed yet, and closes each one: stamps the auction with its
// outcome ("sold" if it had a high bidder, "no_bids" if it never got one)
// and flips the listing to "ended". This is what makes "ended" a real,
// stored fact instead of every reader (ListActive, MyBids,
// HasWonAuctionFrom) independently comparing ends_at to now() — see
// CLAUDE.md §5.3's race-safety principle, applied here to auction close
// instead of bid placement: closed_at is only ever set once per row, and
// the per-row transaction below re-checks it under a row lock, so running
// this from multiple worker instances, or from overlapping ticks of the
// same one, can never double-close (or double-notify on, once notification
// exists) the same auction.
func CloseEndedAuctions(ctx context.Context, pool *pgxpool.Pool) ([]CloseResult, error) {
	rows, err := pool.Query(ctx, `
		select listing_id from auctions
		where closed_at is null and ends_at <= now()
		order by ends_at asc
	`)
	if err != nil {
		return nil, fmt.Errorf("query pending auctions: %w", err)
	}
	var listingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan pending auction: %w", err)
		}
		listingIDs = append(listingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	results := make([]CloseResult, 0, len(listingIDs))
	for _, id := range listingIDs {
		res, err := closeOne(ctx, pool, id)
		if err != nil {
			results = append(results, CloseResult{ListingID: id, Err: err})
			continue
		}
		if res != nil {
			results = append(results, *res)
		}
	}
	return results, nil
}

// closeOne closes a single auction inside its own transaction. Returns
// (nil, nil) if the row turned out to already be closed by the time this
// row's lock was acquired — a harmless race between the outer candidate
// scan above and another pass/instance getting there first, not an error.
func closeOne(ctx context.Context, pool *pgxpool.Pool, listingID string) (*CloseResult, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		currentPrice int64
		highBidderID *string
		bidCount     int32
		endsAt       time.Time
		closedAt     *time.Time
		sellerID     string
	)
	err = tx.QueryRow(ctx, `
		select a.current_price_cents, a.high_bidder_id, a.bid_count, a.ends_at, a.closed_at, l.seller_id
		from auctions a
		join listings l on l.id = a.listing_id
		where a.listing_id = $1
		for update of a
	`, listingID).Scan(&currentPrice, &highBidderID, &bidCount, &endsAt, &closedAt, &sellerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuctionNotFound
		}
		return nil, fmt.Errorf("read auction: %w", err)
	}

	if closedAt != nil {
		return nil, nil
	}
	if time.Now().Before(endsAt) {
		// Shouldn't happen (the candidate scan already filtered on
		// ends_at <= now()), but a bid placed between that scan and this
		// row's lock could in principle extend nothing (there's no
		// soft-close) — still, never close an auction early.
		return nil, nil
	}

	outcome := "sold"
	if highBidderID == nil {
		outcome = "no_bids"
	}

	if _, err := tx.Exec(ctx, `
		update auctions set outcome = $1, closed_at = now() where listing_id = $2
	`, outcome, listingID); err != nil {
		return nil, fmt.Errorf("update auction: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		update listings set status = 'ended' where id = $1
	`, listingID); err != nil {
		return nil, fmt.Errorf("update listing: %w", err)
	}

	if outcome == "sold" {
		if err := notification.Create(ctx, tx, *highBidderID, notification.KindWon, listingID); err != nil {
			return nil, fmt.Errorf("notify won: %w", err)
		}
		if err := notification.Create(ctx, tx, sellerID, notification.KindSold, listingID); err != nil {
			return nil, fmt.Errorf("notify sold: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &CloseResult{
		ListingID:       listingID,
		Outcome:         outcome,
		HighBidderID:    highBidderID,
		FinalPriceCents: currentPrice,
		BidCount:        bidCount,
	}, nil
}
