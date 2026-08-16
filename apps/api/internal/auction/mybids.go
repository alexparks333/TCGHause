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

// MyBid pairs a listing the caller has bid on with their own max bid and
// whether they're currently winning — the real data behind the account
// "Buying" and "Bids/Offers" pages.
type MyBid struct {
	Listing       listing.Listing `json:"listing"`
	MyMaxBidCents int64           `json:"myMaxBidCents"`
	Status        string          `json:"status"` // "winning" | "outbid"
}

func MyBids(ctx context.Context, pool *pgxpool.Pool, bidderID string) ([]MyBid, error) {
	rows, err := pool.Query(ctx, `
		select a.listing_id, a.high_bidder_id,
			(select max(b.max_bid_cents) from bids b
			 where b.auction_listing_id = a.listing_id and b.bidder_id = $1) as my_max
		from auctions a
		join listings l on l.id = a.listing_id
		where l.status in ('active', 'ended')
		and exists (
			select 1 from bids b
			where b.auction_listing_id = a.listing_id and b.bidder_id = $1
		)
		order by a.ends_at asc
	`, bidderID)
	if err != nil {
		return nil, fmt.Errorf("query my bids: %w", err)
	}
	defer rows.Close()

	type row struct {
		listingID    string
		highBidderID *string
		myMax        int64
	}
	var found []row
	for rows.Next() {
		var rw row
		if err := rows.Scan(&rw.listingID, &rw.highBidderID, &rw.myMax); err != nil {
			return nil, fmt.Errorf("scan my bid: %w", err)
		}
		found = append(found, rw)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	listingIDs := make([]string, len(found))
	for i, rw := range found {
		listingIDs[i] = rw.listingID
	}
	listingsByID, err := listing.GetMany(ctx, pool, listingIDs)
	if err != nil {
		return nil, fmt.Errorf("get listings: %w", err)
	}

	out := []MyBid{}
	for _, rw := range found {
		lst, ok := listingsByID[rw.listingID]
		if !ok {
			// A bid's auction_listing_id has a foreign-key reference to
			// listings — this shouldn't be reachable, but skip rather than
			// 500 the whole page over one row if it somehow ever is.
			continue
		}
		status := "outbid"
		if rw.highBidderID != nil && *rw.highBidderID == bidderID {
			status = "winning"
		}
		out = append(out, MyBid{Listing: lst, MyMaxBidCents: rw.myMax, Status: status})
	}
	return out, nil
}

func HandleMyBids(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bidderID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		bids, err := MyBids(r.Context(), pool, bidderID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(bids)
	}
}
