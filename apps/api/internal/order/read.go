package order

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("order not found")

// Order is the read-side shape — everything the order-status page and
// fulfillment endpoints need. Orders exist only for purchases made through
// the real Connect checkout path (Phase 3 onward); a mock-payment purchase,
// or any purchase made before internal/order existed, has no order row at
// all — ErrNotFound in that case, not a bug.
type Order struct {
	ID                    string     `json:"id"`
	ListingID             string     `json:"listingId"`
	BuyerID               string     `json:"buyerId"`
	SellerID              string     `json:"sellerId"`
	State                 State      `json:"state"`
	Rail                  *string    `json:"rail,omitempty"`
	TierAtSale            string     `json:"tierAtSale"`
	SubtotalCents         int64      `json:"subtotalCents"`
	ShippingCents         int64      `json:"shippingCents"`
	SellerFeeCents        int64      `json:"sellerFeeCents"`
	SellerNetCents        int64      `json:"sellerNetCents"`
	TaxCents              int64      `json:"taxCents"`
	ChargedCents          int64      `json:"chargedCents"`
	TrackingNumber        *string    `json:"trackingNumber,omitempty"`
	Carrier               *string    `json:"carrier,omitempty"`
	ShippedAt             *time.Time `json:"shippedAt,omitempty"`
	DeliveredAt           *time.Time `json:"deliveredAt,omitempty"`
	ClaimDeadline         *time.Time `json:"claimDeadline,omitempty"`
	ReleasedAt            *time.Time `json:"releasedAt,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	StripePaymentIntentID *string    `json:"-"`
}

const selectOrderColumns = `
	o.id, oi.listing_id, o.buyer_id, o.seller_id, o.state, o.rail, o.tier_at_sale,
	o.subtotal_cents, o.shipping_cents, o.seller_fee_cents, o.seller_net_cents,
	o.tax_cents, o.charged_cents, o.tracking_number, o.carrier,
	o.shipped_at, o.delivered_at, o.claim_deadline, o.released_at, o.created_at,
	o.stripe_payment_intent_id
`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	err := row.Scan(
		&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.State, &o.Rail, &o.TierAtSale,
		&o.SubtotalCents, &o.ShippingCents, &o.SellerFeeCents, &o.SellerNetCents,
		&o.TaxCents, &o.ChargedCents, &o.TrackingNumber, &o.Carrier,
		&o.ShippedAt, &o.DeliveredAt, &o.ClaimDeadline, &o.ReleasedAt, &o.CreatedAt,
		&o.StripePaymentIntentID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan order: %w", err)
	}
	return &o, nil
}

// GetByID looks up an order by its own id — what internal/dispute uses,
// since a claim references orders.id directly, not a listing id.
func GetByID(ctx context.Context, pool *pgxpool.Pool, orderID string) (*Order, error) {
	row := pool.QueryRow(ctx, `
		select `+selectOrderColumns+`
		from orders o
		join order_items oi on oi.order_id = o.id
		where o.id = $1
	`, orderID)
	return scanOrder(row)
}

// GetForListing returns the order tied to listingID, via order_items'
// unique listing_id — the natural join point, since a listing sells at
// most once, ever.
func GetForListing(ctx context.Context, pool *pgxpool.Pool, listingID string) (*Order, error) {
	row := pool.QueryRow(ctx, `
		select `+selectOrderColumns+`
		from orders o
		join order_items oi on oi.order_id = o.id
		where oi.listing_id = $1
	`, listingID)
	return scanOrder(row)
}

// GetByPaymentIntentID looks up an order by the Stripe PaymentIntent that
// paid for it — what the webhook (internal/webhook) uses to resolve
// payment_intent.succeeded/charge.failed events into an order transition,
// since Stripe only ever tells us the PaymentIntent id, never our internal
// order id.
func GetByPaymentIntentID(ctx context.Context, pool *pgxpool.Pool, paymentIntentID string) (*Order, error) {
	row := pool.QueryRow(ctx, `
		select `+selectOrderColumns+`
		from orders o
		join order_items oi on oi.order_id = o.id
		where o.stripe_payment_intent_id = $1
	`, paymentIntentID)
	return scanOrder(row)
}

// GetByTrackingNumber looks up an order by its recorded tracking number —
// what the carrier delivery webhook (internal/shipping) uses to figure out
// which order a "delivered" scan belongs to, since the carrier only ever
// knows the tracking number, never our internal order id.
func GetByTrackingNumber(ctx context.Context, pool *pgxpool.Pool, trackingNumber string) (*Order, error) {
	row := pool.QueryRow(ctx, `
		select `+selectOrderColumns+`
		from orders o
		join order_items oi on oi.order_id = o.id
		where o.tracking_number = $1
	`, trackingNumber)
	return scanOrder(row)
}
