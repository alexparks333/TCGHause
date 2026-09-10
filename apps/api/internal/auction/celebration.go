package auction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/buyerreview"
	"auctionhous-tcg/api/internal/feedback"
	"auctionhous-tcg/api/internal/platform"
)

var ErrInvalidCelebrationKind = errors.New(`kind must be "win", "sale", or "review"`)

// CelebrationItem is one listing a "Bid Won!" / "Item Sold!" / "New
// Review!" toast should show — just enough to render the toast and link
// back to the listing, not the full Listing shape. PriceCents is what a
// win/sale toast shows; Rating is what a review toast shows instead — the
// two are mutually exclusive depending on which list (Wins/Sales vs
// Reviews) an item came from, not both populated at once.
type CelebrationItem struct {
	ListingID  string   `json:"listingId"`
	Title      string   `json:"title"`
	ImageURL   string   `json:"imageUrl,omitempty"`
	PriceCents int64    `json:"priceCents"`
	Rating     *float64 `json:"rating,omitempty"`
}

// Celebrations is every closed-auction outcome (or new review) the caller
// hasn't been shown a celebration for yet — Wins/Sales from a completed
// purchase, Reviews from either direction (a buyer reviewing the seller,
// or the seller reviewing the buyer back). A caller can appear in more
// than one list at once, but never twice in the same list for the same
// listing, since AckCelebration is what stops it from being returned
// again.
type Celebrations struct {
	Wins    []CelebrationItem `json:"wins"`
	Sales   []CelebrationItem `json:"sales"`
	Reviews []CelebrationItem `json:"reviews"`
}

func queryCelebrationItems(ctx context.Context, pool *pgxpool.Pool, query, userID string) ([]CelebrationItem, error) {
	rows, err := pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query celebrations: %w", err)
	}
	defer rows.Close()

	out := []CelebrationItem{}
	for rows.Next() {
		var item CelebrationItem
		var imageURLs []string
		if err := rows.Scan(&item.ListingID, &item.Title, &imageURLs, &item.PriceCents); err != nil {
			return nil, fmt.Errorf("scan celebration: %w", err)
		}
		if len(imageURLs) > 0 {
			item.ImageURL = imageURLs[0]
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// PendingCelebrations returns every "Bid Won!" (bought as the high bidder,
// whether via bidding or Buy It Now) and "Item Sold!" (sold as the seller,
// same either way) toast userID hasn't seen yet. Two sources, unioned:
// auction outcomes ('sold' = won via bidding, 'bought_now' = bought
// outright, both set by internal/auction/close.go or buynow.go — a
// not-yet-closed auction, even one whose ends_at has passed, never shows
// up here early), and fixed-format listings bought directly via
// listing.BuyNowFixed, which have no auctions row at all so track buyer/
// celebrated state on the listing itself.
func PendingCelebrations(ctx context.Context, pool *pgxpool.Pool, userID string) (*Celebrations, error) {
	auctionWins, err := queryCelebrationItems(ctx, pool, `
		select l.id, l.title, l.image_urls, a.current_price_cents
		from auctions a
		join listings l on l.id = a.listing_id
		where a.outcome in ('sold', 'bought_now') and a.high_bidder_id = $1 and a.buyer_celebrated_at is null
		order by a.closed_at asc
	`, userID)
	if err != nil {
		return nil, err
	}
	fixedWins, err := queryCelebrationItems(ctx, pool, `
		select l.id, l.title, l.image_urls, coalesce(l.sold_price_cents, l.price_cents)
		from listings l
		where l.buyer_id = $1 and l.buyer_celebrated_at is null
		order by l.sold_at asc
	`, userID)
	if err != nil {
		return nil, err
	}

	auctionSales, err := queryCelebrationItems(ctx, pool, `
		select l.id, l.title, l.image_urls, a.current_price_cents
		from auctions a
		join listings l on l.id = a.listing_id
		where a.outcome in ('sold', 'bought_now') and l.seller_id = $1 and a.seller_celebrated_at is null
		order by a.closed_at asc
	`, userID)
	if err != nil {
		return nil, err
	}
	fixedSales, err := queryCelebrationItems(ctx, pool, `
		select l.id, l.title, l.image_urls, coalesce(l.sold_price_cents, l.price_cents)
		from listings l
		where l.seller_id = $1 and l.buyer_id is not null and l.seller_celebrated_at is null
		order by l.sold_at asc
	`, userID)
	if err != nil {
		return nil, err
	}

	sellerReviews, err := feedback.PendingSellerReviewCelebrations(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	buyerReviews, err := buyerreview.PendingBuyerReviewCelebrations(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	reviews := make([]CelebrationItem, 0, len(sellerReviews)+len(buyerReviews))
	for _, r := range sellerReviews {
		reviews = append(reviews, reviewCelebrationItem(r.ListingID, r.Title, r.ImageURLs, r.Rating))
	}
	for _, r := range buyerReviews {
		reviews = append(reviews, reviewCelebrationItem(r.ListingID, r.Title, r.ImageURLs, r.Rating))
	}

	return &Celebrations{
		Wins:    append(auctionWins, fixedWins...),
		Sales:   append(auctionSales, fixedSales...),
		Reviews: reviews,
	}, nil
}

func reviewCelebrationItem(listingID, title string, imageURLs []string, rating float64) CelebrationItem {
	item := CelebrationItem{ListingID: listingID, Title: title, Rating: &rating}
	if len(imageURLs) > 0 {
		item.ImageURL = imageURLs[0]
	}
	return item
}

// AckCelebration marks listingID's win or sale celebration as shown to
// userID, so PendingCelebrations never returns it again. Always runs both
// the auction-outcome update and the fixed-listing update — harmless,
// since a given listing only ever matches one of them (an auction-format
// listing has no matching buyer_id row on listings; a fixed-format one has
// no matching row in auctions at all), so exactly one is ever a real
// no-op rather than both mattering.
//
// A no-op (not an error) if userID isn't actually that listing's winner/
// seller, it was already acked, or the sale hasn't actually closed yet —
// that last check matters even though the frontend only ever acks items it
// just received from PendingCelebrations (which already implies closed):
// without it, a client that (incorrectly) acked before close would
// permanently suppress the real celebration once the purchase actually
// completed, since buyer_celebrated_at would already be non-null by the
// time PendingCelebrations looked for it. The frontend only ever calls
// this for items it just received from its own PendingCelebrations
// response, so there's nothing to distinguish for a legitimate caller;
// silently doing nothing is exactly as correct as erroring, without giving
// a forged request any signal about whether a listing/kind combination
// exists.
func AckCelebration(ctx context.Context, pool *pgxpool.Pool, userID, listingID, kind string) error {
	var auctionQuery, listingQuery string
	switch kind {
	case "win":
		auctionQuery = `
			update auctions set buyer_celebrated_at = now()
			where listing_id = $1 and high_bidder_id = $2
				and outcome in ('sold', 'bought_now') and buyer_celebrated_at is null
		`
		listingQuery = `
			update listings set buyer_celebrated_at = now()
			where id = $1 and buyer_id = $2 and buyer_celebrated_at is null
		`
	case "sale":
		auctionQuery = `
			update auctions a set seller_celebrated_at = now()
			from listings l
			where l.id = a.listing_id and a.listing_id = $1 and l.seller_id = $2
				and a.outcome in ('sold', 'bought_now') and a.seller_celebrated_at is null
		`
		listingQuery = `
			update listings set seller_celebrated_at = now()
			where id = $1 and seller_id = $2 and buyer_id is not null and seller_celebrated_at is null
		`
	case "review":
		// A review celebration always came from exactly one of
		// feedback/buyerreview's own tables (never both for the same
		// listing+user), so trying both here is the same "harmless no-op
		// on whichever one doesn't apply" pattern as the win/sale cases
		// above — just delegated to those packages instead of inlining
		// their schema here.
		if err := feedback.AckSellerReviewCelebration(ctx, pool, userID, listingID); err != nil {
			return fmt.Errorf("ack celebration (seller review): %w", err)
		}
		if err := buyerreview.AckBuyerReviewCelebration(ctx, pool, userID, listingID); err != nil {
			return fmt.Errorf("ack celebration (buyer review): %w", err)
		}
		return nil
	default:
		return ErrInvalidCelebrationKind
	}
	if _, err := pool.Exec(ctx, auctionQuery, listingID, userID); err != nil {
		return fmt.Errorf("ack celebration (auction): %w", err)
	}
	if _, err := pool.Exec(ctx, listingQuery, listingID, userID); err != nil {
		return fmt.Errorf("ack celebration (listing): %w", err)
	}
	return nil
}

func HandleMyCelebrations(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		celebrations, err := PendingCelebrations(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(celebrations)
	}
}

type ackCelebrationInput struct {
	ListingID string `json:"listingId"`
	Kind      string `json:"kind"`
}

func HandleAckCelebration(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var in ackCelebrationInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if in.Kind != "win" && in.Kind != "sale" && in.Kind != "review" {
			http.Error(w, ErrInvalidCelebrationKind.Error(), http.StatusBadRequest)
			return
		}

		if err := AckCelebration(r.Context(), pool, userID, in.ListingID, in.Kind); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
