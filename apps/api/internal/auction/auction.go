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

var (
	ErrAuctionNotFound = errors.New("auction not found")
	ErrAuctionEnded    = errors.New("auction has ended")
	ErrBidTooLow       = errors.New("bid does not meet the minimum required amount")
	ErrConflict        = errors.New("bid conflicted with a concurrent bid — please retry")
	ErrSelfBid         = errors.New("sellers cannot bid on their own listing")
)

const maxRetries = 5

// BidResult is the public view after a bid: only the resulting price and
// who's winning — never anyone's private max (CLAUDE.md §6.1).
type BidResult struct {
	CurrentPriceCents int64     `json:"currentPriceCents"`
	HighBidderID      string    `json:"highBidderId"`
	YouAreHighBidder  bool      `json:"youAreHighBidder"`
	EndsAt            time.Time `json:"endsAt"`
	BidCount          int32     `json:"bidCount"`
}

// minIncrement is the product-decided tiered bid-increment table (explicit
// product call, overriding eBay's more granular schedule): under $50 moves
// in $0.25 steps, $50–$500 moves in $1 steps, $500+ moves in $10 steps.
func minIncrement(priceCents int64) int64 {
	switch {
	case priceCents < 5000: // < $50
		return 25
	case priceCents < 50000: // $50 - $500
		return 100
	default: // $500+
		return 1000
	}
}

// roundUpPastGrid returns the smallest multiple of amountCents' tier
// increment that is strictly greater than amountCents. Bidders can enter any
// exact max (e.g. $72.50) — that's never rejected or snapped — but the
// *visible* auction price must always land on a clean grid point for its
// tier, never an odd-cents value like $73.50 just because a losing
// challenger's private max happened to be $72.50. $72.50 rounds up past the
// $1 grid to $73.00, not $72.50 + $1.
func roundUpPastGrid(amountCents int64) int64 {
	step := minIncrement(amountCents)
	return (amountCents/step + 1) * step
}

// PlaceBid submits bidderID's private proxy max for listingID's auction.
// The visible current price only rises as far as needed to beat the
// second-highest max (CLAUDE.md §6.1). The end time is fixed — classic
// hard-close, matching eBay's actual default behavior: whoever holds the
// highest bid the instant the clock hits zero wins, no auto-extend. Race-safe
// via auctions.version optimistic concurrency (CLAUDE.md §5.3): two
// simultaneous bids can never both "win."
func PlaceBid(ctx context.Context, pool *pgxpool.Pool, listingID, bidderID string, maxBidCents int64) (*BidResult, error) {
	for attempt := 0; attempt < maxRetries; attempt++ {
		result, err := attemptBid(ctx, pool, listingID, bidderID, maxBidCents)
		if err == nil {
			return result, nil
		}
		if !errors.Is(err, ErrConflict) {
			return nil, err
		}
		// Another bid committed between our read and write — retry against
		// the now-current state rather than surfacing a spurious failure.
	}
	return nil, fmt.Errorf("could not place bid after %d attempts: %w", maxRetries, ErrConflict)
}

func attemptBid(ctx context.Context, pool *pgxpool.Pool, listingID, bidderID string, maxBidCents int64) (*BidResult, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		startingBid, currentPrice int64
		highBidderID              *string
		version                   int64
		endsAt                    time.Time
		bidCount                  int32
		sellerID                  string
	)
	err = tx.QueryRow(ctx, `
		select a.starting_bid_cents, a.current_price_cents, a.high_bidder_id, a.version, a.ends_at, a.bid_count, l.seller_id
		from auctions a
		join listings l on l.id = a.listing_id
		where a.listing_id = $1
	`, listingID).Scan(&startingBid, &currentPrice, &highBidderID, &version, &endsAt, &bidCount, &sellerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuctionNotFound
		}
		return nil, fmt.Errorf("read auction: %w", err)
	}

	if bidderID == sellerID {
		return nil, ErrSelfBid
	}

	now := time.Now()
	if now.After(endsAt) {
		return nil, ErrAuctionEnded
	}

	var newPrice int64
	var newHighBidder string
	// Set only when this bid displaces a previous high bidder — that's the
	// one case worth a persistent "you've been outbid" notification (see
	// the default case below).
	var outbidUserID *string

	switch {
	case highBidderID == nil:
		// First bid on this auction — must meet the seller's starting bid.
		if maxBidCents < startingBid {
			return nil, ErrBidTooLow
		}
		newPrice = startingBid
		newHighBidder = bidderID

	case *highBidderID == bidderID:
		// Raising your own max: you're already winning, so the visible
		// price doesn't move — just require staying at/above it.
		if maxBidCents < currentPrice {
			return nil, ErrBidTooLow
		}
		newPrice = currentPrice
		newHighBidder = bidderID

	default:
		var leaderMax int64
		err = tx.QueryRow(ctx, `
			select coalesce(max(max_bid_cents), 0) from bids
			where auction_listing_id = $1 and bidder_id = $2
		`, listingID, *highBidderID).Scan(&leaderMax)
		if err != nil {
			return nil, fmt.Errorf("read leader max: %w", err)
		}

		minRequired := currentPrice + minIncrement(currentPrice)
		if maxBidCents < minRequired {
			return nil, ErrBidTooLow
		}

		if maxBidCents > leaderMax {
			// New bidder takes the lead, paying just enough to beat the
			// previous leader's max (classic second-price proxy behavior),
			// rounded up to a clean grid point rather than leaderMax's exact
			// odd-cents value. The old leader (still *highBidderID here,
			// captured before newHighBidder overwrites it) just lost the
			// lead without taking any action themselves — that's exactly
			// the case worth notifying, unlike a challenger whose own
			// fresh bid didn't take the lead (they're already looking at
			// the result of their own action).
			outbidUserID = highBidderID
			newHighBidder = bidderID
			newPrice = roundUpPastGrid(leaderMax)
			if newPrice > maxBidCents {
				newPrice = maxBidCents
			}
		} else {
			// New bidder's max doesn't beat the leader — leader keeps
			// winning, but the price rises to just beat the new challenger,
			// again rounded up to a clean grid point.
			newHighBidder = *highBidderID
			newPrice = roundUpPastGrid(maxBidCents)
			if newPrice > leaderMax {
				newPrice = leaderMax
			}
		}
	}

	tag, err := tx.Exec(ctx, `
		update auctions
		set current_price_cents = $1, high_bidder_id = $2, version = version + 1,
			bid_count = bid_count + 1
		where listing_id = $3 and version = $4
	`, newPrice, newHighBidder, listingID, version)
	if err != nil {
		return nil, fmt.Errorf("update auction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrConflict
	}

	if _, err := tx.Exec(ctx, `
		insert into bids (auction_listing_id, bidder_id, max_bid_cents)
		values ($1, $2, $3)
	`, listingID, bidderID, maxBidCents); err != nil {
		return nil, fmt.Errorf("insert bid: %w", err)
	}

	if outbidUserID != nil {
		if err := notification.Create(ctx, tx, *outbidUserID, notification.KindOutbid, listingID); err != nil {
			return nil, fmt.Errorf("notify outbid: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &BidResult{
		CurrentPriceCents: newPrice,
		HighBidderID:      newHighBidder,
		YouAreHighBidder:  newHighBidder == bidderID,
		EndsAt:            endsAt,
		BidCount:          bidCount + 1,
	}, nil
}
