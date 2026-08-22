package order

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// Summary is one row of the Transactions list — an Order plus exactly the
// denormalized fields that view needs (listing title/photo, and whichever
// side of the trade ISN'T the caller), so the frontend never has to
// separately fetch every listing just to render a list of orders. Embeds
// Order so every field on the order-status page's Order type is already
// here too — Summary is a superset, not a parallel shape.
type Summary struct {
	Order
	ListingTitle         string  `json:"listingTitle"`
	ListingImageURL      *string `json:"listingImageUrl,omitempty"`
	CounterpartyID       string  `json:"counterpartyId"`
	CounterpartyUsername *string `json:"counterpartyUsername"`
	// SellerUsername/BuyerUsername are both sides' usernames, unconditional
	// on viewer perspective — unlike CounterpartyUsername (which side ISN'T
	// the caller), the Transactions list's csfloat-style stepper always
	// shows Seller on one end and Buyer on the other regardless of which
	// one the viewer is, so it needs both names, not just "the other one."
	SellerUsername *string `json:"sellerUsername"`
	BuyerUsername  *string `json:"buyerUsername"`
	// ViewerIsSeller tells the client which side of this order the caller
	// is on without having to compare ids itself against its own session —
	// same "derive server-side, don't re-derive client-side" rule as the
	// rest of this codebase's auth-adjacent fields.
	ViewerIsSeller bool `json:"viewerIsSeller"`
}

// ListForUser returns every order userID is a participant in, either as
// buyer or seller, newest first — the Transactions tab's one query. Each
// row already carries the listing's title/first photo and the other
// party's username, so the list can render without N+1 listing fetches.
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID string) ([]Summary, error) {
	rows, err := pool.Query(ctx, `
		select `+selectOrderColumns+`,
			l.title, l.image_urls[1],
			case when o.buyer_id = $1 then o.seller_id else o.buyer_id end,
			case when o.buyer_id = $1 then su.username else bu.username end,
			su.username, bu.username
		from orders o
		join order_items oi on oi.order_id = o.id
		join listings l on l.id = oi.listing_id
		join users su on su.id = o.seller_id
		join users bu on bu.id = o.buyer_id
		where o.buyer_id = $1 or o.seller_id = $1
		order by o.created_at desc
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query orders for user: %w", err)
	}
	defer rows.Close()

	out := []Summary{}
	for rows.Next() {
		s, err := scanSummary(rows, userID)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func scanSummary(row pgx.Row, viewerID string) (*Summary, error) {
	var s Summary
	o := &s.Order
	err := row.Scan(
		&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.State, &o.Rail, &o.TierAtSale,
		&o.SubtotalCents, &o.ShippingCents, &o.SellerFeeCents, &o.SellerNetCents,
		&o.TaxCents, &o.ChargedCents, &o.TrackingNumber, &o.Carrier,
		&o.ShippedAt, &o.DeliveredAt, &o.ClaimDeadline, &o.ReleasedAt, &o.CreatedAt,
		&o.StripePaymentIntentID, &o.ShippingTier, &o.SignatureRequired,
		&o.EasypostShipmentID, &o.LabelCostCents, &o.LabelURL,
		&s.ListingTitle, &s.ListingImageURL, &s.CounterpartyID, &s.CounterpartyUsername,
		&s.SellerUsername, &s.BuyerUsername,
	)
	if err != nil {
		return nil, fmt.Errorf("scan order summary: %w", err)
	}
	s.ViewerIsSeller = o.SellerID == viewerID
	return &s, nil
}

// HandleListMine backs the Transactions tab (mobile + web) — every order
// the caller is a participant in, buyer or seller side, so both apps can
// render one merged list rather than stitching together separate "my
// purchases" and "my sales" order views.
func HandleListMine(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		orders, err := ListForUser(r.Context(), pool, callerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(orders)
	}
}
