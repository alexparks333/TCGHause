package auction

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/shipping"
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
		res, err := closeOne(ctx, pool, id, false)
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
// force is only ever true from EndListing's "sell to the high bidder"
// early-end path (end_listing.go) — it skips the ends_at-hasn't-passed
// guard below (the whole point of ending early) and clamps ends_at down to
// now() in the update, so a countdown or "time left" reading this listing
// later never shows a scheduled end time that's now a lie.
func closeOne(ctx context.Context, pool *pgxpool.Pool, listingID string, force bool) (*CloseResult, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		currentPrice           int64
		highBidderID           *string
		bidCount               int32
		endsAt                 time.Time
		closedAt               *time.Time
		sellerID               string
		shippingPreset         string
		estimatedShippingCents *int64
		requestSignature       bool
	)
	err = tx.QueryRow(ctx, `
		select a.current_price_cents, a.high_bidder_id, a.bid_count, a.ends_at, a.closed_at, l.seller_id,
			l.shipping_preset, l.estimated_shipping_cents, l.request_signature
		from auctions a
		join listings l on l.id = a.listing_id
		where a.listing_id = $1
		for update of a
	`, listingID).Scan(&currentPrice, &highBidderID, &bidCount, &endsAt, &closedAt, &sellerID,
		&shippingPreset, &estimatedShippingCents, &requestSignature)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuctionNotFound
		}
		return nil, fmt.Errorf("read auction: %w", err)
	}

	if closedAt != nil {
		return nil, nil
	}
	if !force && time.Now().Before(endsAt) {
		// Shouldn't happen (the candidate scan already filtered on
		// ends_at <= now()), but a bid placed between that scan and this
		// row's lock could in principle extend nothing (there's no
		// soft-close) — still, never close an auction early on a natural
		// (non-forced) pass.
		return nil, nil
	}

	outcome := "sold"
	if highBidderID == nil {
		outcome = "no_bids"
	}

	// least(ends_at, now()) is a no-op on a natural close (ends_at is
	// already <= now()) and clamps it down to the real end time on a
	// forced early close — one expression instead of branching the SQL on
	// force.
	if _, err := tx.Exec(ctx, `
		update auctions set outcome = $1, closed_at = now(), ends_at = least(ends_at, now()) where listing_id = $2
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

	// Best-effort, logged not returned — same "layered on top of an
	// already-committed decision" reasoning as createOrderRecord's own doc
	// comment: the ownership/outcome decision above is what has to be
	// atomic, a failure creating the pending order here must never look
	// like the auction close itself failed.
	if outcome == "sold" {
		CreatePendingOrderForWin(ctx, pool, listingID, *highBidderID, sellerID, currentPrice, shippingPreset, estimatedShippingCents, requestSignature)
	}

	return &CloseResult{
		ListingID:       listingID,
		Outcome:         outcome,
		HighBidderID:    highBidderID,
		FinalPriceCents: currentPrice,
		BidCount:        bidCount,
	}, nil
}

// CreatePendingOrderForWin inserts the real, unpaid orders row the instant
// a listing closes with a winner — a won-but-unpaid auction (or an
// accepted-offer sale, internal/offer.Accept) is a real fact, so the
// Transactions page (GET /me/orders) gets a real order row (state=created)
// for it immediately, not just a client-side "Pay Now" pill with no backing
// row (same "don't fabricate what looks real" rule as everywhere else in
// this codebase). Rail is unknown until the buyer actually pays, so
// CreateInput.Rail is left empty — buynow.go's createOrderRecord finds this
// exact row (order_items' unique listing_id index guarantees there's at
// most one) and finalizes it in place via order.FinalizePayment once
// payment succeeds, rather than inserting a second row.
func CreatePendingOrderForWin(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID, sellerID string, finalPriceCents int64, shippingPresetIn string, estimatedShippingCents *int64, requestSignature bool) {
	resolvedPreset, signatureRequired := shipping.UpgradePreset(shipping.Preset(shippingPresetIn), finalPriceCents, requestSignature)
	shippingCents := shipping.ChargedCents(resolvedPreset, estimatedShippingCents)

	quote, tier, tierPct, err := quoteForListing(ctx, pool, sellerID, finalPriceCents, shippingCents)
	if err != nil {
		log.Printf("auction close: failed to compute pending-order quote for %s: %v", listingID, err)
		return
	}

	if _, err := order.CreateFromWin(ctx, pool, listingID, buyerID, sellerID, order.CreateInput{
		Quote:             quote,
		Tier:              string(tier),
		TierPct:           tierPct,
		ShippingPreset:    string(resolvedPreset),
		SignatureRequired: signatureRequired,
	}); err != nil {
		log.Printf("auction close: failed to create pending order for %s: %v", listingID, err)
	}
}
