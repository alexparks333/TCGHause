package auction

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/listing"
)

// EndListingAction is the seller's choice when ending an auction that
// already has at least one bid — mirrors eBay's own real early-ending
// rules (researched against eBay's own seller/developer docs; the full
// writeup is docs/EditListing.md), which never let a seller just make
// bids disappear silently. There's no "just delete it" option once a real
// bidder is involved: the seller either honors the current high bid as a
// real sale, or explicitly voids every bid with a stated reason.
type EndListingAction string

const (
	EndActionSellToHighBidder EndListingAction = "sell_to_high_bidder"
	EndActionCancelBids       EndListingAction = "cancel_bids"
)

// EndListingReason is required only for EndActionCancelBids — the same
// small set of reasons eBay's own Trading API asks a seller to choose
// from (EndReasonCodeType), trimmed to what actually applies on this
// marketplace rather than eBay's full enum.
type EndListingReason string

const (
	ReasonLostOrBroken   EndListingReason = "lost_or_broken"
	ReasonErrorInListing EndListingReason = "error_in_listing"
	ReasonNotAvailable   EndListingReason = "not_available"
)

func (r EndListingReason) Valid() bool {
	switch r {
	case ReasonLostOrBroken, ReasonErrorInListing, ReasonNotAvailable:
		return true
	}
	return false
}

// endEarlyCutoff mirrors eBay's own real rule: an auction with a
// qualifying bid can't be ended early at all once it's this close to its
// scheduled end — the only path left from that point on is letting it
// close naturally (CloseEndedAuctions' own worker sweep).
const endEarlyCutoff = 12 * time.Hour

var (
	// ErrActionRequired is returned when a bid-having auction's caller
	// didn't specify EndActionSellToHighBidder or EndActionCancelBids —
	// unlike a fixed-price listing or a never-bid-on auction, there's no
	// single unambiguous "delete" here for the HTTP layer to default to.
	ErrActionRequired = errors.New("this auction has a bid — choose sell_to_high_bidder or cancel_bids")
	// ErrInvalidReason is returned when EndActionCancelBids is chosen
	// without a valid EndListingReason.
	ErrInvalidReason = errors.New("cancel_bids requires a valid reason")
	// ErrTooCloseToEnd is returned when a bid-having auction is within
	// endEarlyCutoff of its scheduled end — real eBay's own hard stop,
	// not an app-invented restriction.
	ErrTooCloseToEnd = errors.New("this auction ends in 12 hours or less and can no longer be ended early — it can only close naturally")
)

// EndListing is the single real entry point behind "Delete Listing" (the
// Selling page's ⋮ menu, DELETE /listings/{id}) — deliberately not just
// internal/listing.Cancel anymore. A fixed-price listing, or an auction
// that's never had a bid, is still a free, no-consequence delete (delegated
// straight to listing.Cancel, unchanged). Once a real bidder is involved,
// this now mirrors eBay's actual early-ending rules instead of this app's
// earlier, stricter "always blocked" behavior — see docs/EditListing.md
// for the full research and the reasoning behind every rule enforced here.
func EndListing(ctx context.Context, pool *pgxpool.Pool, listingID, sellerID string, action EndListingAction, reason EndListingReason) error {
	lst, err := listing.Get(ctx, pool, listingID)
	if err != nil {
		return err
	}
	if lst.SellerID != sellerID {
		return listing.ErrNotOwner
	}
	if lst.Status != "active" {
		return listing.ErrNotActive
	}

	hasBids := lst.Format == listing.FormatAuction && lst.BidCount != nil && *lst.BidCount > 0
	if !hasBids {
		return listing.Cancel(ctx, pool, listingID, sellerID)
	}

	if lst.EndsAt != nil && time.Until(*lst.EndsAt) <= endEarlyCutoff {
		return ErrTooCloseToEnd
	}

	switch action {
	case EndActionSellToHighBidder:
		_, err := closeOne(ctx, pool, listingID, true)
		return err
	case EndActionCancelBids:
		if !reason.Valid() {
			return ErrInvalidReason
		}
		return endEarlyCancelBids(ctx, pool, listingID, reason)
	default:
		return ErrActionRequired
	}
}

// endEarlyCancelBids voids every bid on a still-live auction and ends it
// unsuccessfully, right now — the seller's other early-end option besides
// honoring the current high bid. Deliberately does NOT delete or mutate
// the bids rows themselves (an append-only record of what buyers actually
// did, same "never mutate history" principle CLAUDE.md's wallet-ledger
// design applies elsewhere) — it clears high_bidder_id so nothing
// downstream (AuctionPriceBox, MyBids) mistakes the last bidder for a
// winner, and records outcome/cancel_reason as the real, permanent fact of
// what happened. listings.status = 'cancelled' reuses the exact same
// status a never-bid-on delete already used, so every existing "don't show
// a cancelled listing" filter (ListActive, MyBids, CountsByGame) already
// excludes this correctly with no separate case to add.
func endEarlyCancelBids(ctx context.Context, pool *pgxpool.Pool, listingID string, reason EndListingReason) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		update auctions
		set outcome = 'cancelled', closed_at = now(), ends_at = least(ends_at, now()),
			cancel_reason = $1, high_bidder_id = null
		where listing_id = $2 and closed_at is null
	`, string(reason), listingID)
	if err != nil {
		return fmt.Errorf("update auction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Lost a race with a natural close (or another cancel) between
		// EndListing's own read and this transaction's write — treat it
		// the same as any other "not active anymore" outcome.
		return listing.ErrNotActive
	}

	if _, err := tx.Exec(ctx, `
		update listings set status = 'cancelled' where id = $1
	`, listingID); err != nil {
		return fmt.Errorf("update listing: %w", err)
	}

	return tx.Commit(ctx)
}
