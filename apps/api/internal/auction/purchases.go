package auction

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/platform"
)

// MyPurchases returns every listing buyerID has actually bought — the real
// data behind the Buy History page. Two ways to end up owning a listing,
// unioned: winning an auction (bidding or Buy It Now, outcome in ('sold',
// 'bought_now') with buyerID as high_bidder_id) or buying a fixed-format
// listing outright (listing.buyer_id). Ordered newest purchase first.
//
// There's still no internal/order model wired in here yet (design doc v2
// §5), but each result's PaidAt (migration 0019) reflects a real fact:
// whether a Stripe charge actually captured for it, set by
// HandleBuyNow/PayForWonAuction at the moment that happens, never guessed or
// backfilled. The Buy History
// page shows a row as awaiting payment exactly when PaidAt is genuinely
// nil — a purchase made through the no-Stripe mock-payment path, or a
// plain auction win via bidding (no checkout step exists for that until
// the buyer visits Bids/Offers' "Awaiting Payment" action).
func MyPurchases(ctx context.Context, pool *pgxpool.Pool, buyerID string) ([]listing.Listing, error) {
	rows, err := pool.Query(ctx, `
		select l.id
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.buyer_id = $1
			or (a.high_bidder_id = $1 and a.outcome in ('sold', 'bought_now'))
		order by coalesce(l.sold_at, a.closed_at) desc
	`, buyerID)
	if err != nil {
		return nil, fmt.Errorf("query my purchases: %w", err)
	}

	var listingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan purchase: %w", err)
		}
		listingIDs = append(listingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	listingsByID, err := listing.GetMany(ctx, pool, listingIDs)
	if err != nil {
		return nil, fmt.Errorf("get listings: %w", err)
	}

	// listingIDs is already in the right (newest-first) order; GetMany's
	// map doesn't preserve it, so rebuild the ordered slice from it rather
	// than ranging over the map.
	out := make([]listing.Listing, 0, len(listingIDs))
	for _, id := range listingIDs {
		if lst, ok := listingsByID[id]; ok {
			out = append(out, lst)
		}
	}
	return out, nil
}

func HandleMyPurchases(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		purchases, err := MyPurchases(r.Context(), pool, buyerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(purchases)
	}
}

// MySales is MyPurchases' mirror image — every listing sellerID has
// actually sold, newest first — the real data behind the Sold History
// page. Same two purchase shapes, just scoped by seller_id instead of
// buyer/high_bidder: an auction that closed with a winner, or a
// fixed-format listing with a buyer.
func MySales(ctx context.Context, pool *pgxpool.Pool, sellerID string) ([]listing.Listing, error) {
	rows, err := pool.Query(ctx, `
		select l.id
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.seller_id = $1
			and (l.buyer_id is not null or a.outcome in ('sold', 'bought_now'))
		order by coalesce(l.sold_at, a.closed_at) desc
	`, sellerID)
	if err != nil {
		return nil, fmt.Errorf("query my sales: %w", err)
	}

	var listingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan sale: %w", err)
		}
		listingIDs = append(listingIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	listingsByID, err := listing.GetMany(ctx, pool, listingIDs)
	if err != nil {
		return nil, fmt.Errorf("get listings: %w", err)
	}

	out := make([]listing.Listing, 0, len(listingIDs))
	for _, id := range listingIDs {
		if lst, ok := listingsByID[id]; ok {
			out = append(out, lst)
		}
	}
	return out, nil
}

func HandleMySales(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		sales, err := MySales(r.Context(), pool, sellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sales)
	}
}
