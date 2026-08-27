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
	ID             string  `json:"id"`
	ListingID      string  `json:"listingId"`
	BuyerID        string  `json:"buyerId"`
	SellerID       string  `json:"sellerId"`
	State          State   `json:"state"`
	Rail           *string `json:"rail,omitempty"`
	TierAtSale     string  `json:"tierAtSale"`
	TierPctAtSale  float64 `json:"tierPctAtSale"`
	SubtotalCents  int64   `json:"subtotalCents"`
	ShippingCents  int64   `json:"shippingCents"`
	SellerFeeCents int64   `json:"sellerFeeCents"`
	SellerNetCents int64   `json:"sellerNetCents"`
	// DiscountCents is always 0 on the card rail — only an ACH-rail order
	// ever has this subtracted from Subtotal on the buyer's side (never
	// from seller_net_cents, see pkg/fees.SellerNet's own comment: the
	// seller's payout never depends on which rail the buyer chose).
	// Surfaced so the receipt's "what your buyer paid" math actually sums
	// to ChargedCents for both rails, not just the card rail.
	DiscountCents         int64      `json:"discountCents"`
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
	// ShippingPreset/SignatureRequired snapshot internal/shipping.
	// UpgradePreset's result (the listing's chosen preset, upgraded if the
	// final price demands it) at order-creation time — see
	// order.CreateFromWin. Nil ShippingPreset only for orders created
	// before this feature existed. ProviderShipmentID/LabelCostCents/LabelURL
	// are populated once the seller actually buys a label
	// (internal/shipping.HandleBuyLabel) — all nil until then.
	// ProviderShipmentID is deliberately vendor-neutral (not "EasypostID" —
	// the vendor changed once already, see internal/shipping's doc comment).
	ShippingPreset     *string `json:"shippingPreset,omitempty"`
	SignatureRequired  bool    `json:"signatureRequired"`
	ProviderShipmentID *string `json:"-"`
	LabelCostCents     *int64  `json:"labelCostCents,omitempty"`
	LabelURL           *string `json:"labelUrl,omitempty"`
}

const selectOrderColumns = `
	o.id, oi.listing_id, o.buyer_id, o.seller_id, o.state, o.rail, o.tier_at_sale,
	o.tier_pct_at_sale,
	o.subtotal_cents, o.shipping_cents, o.seller_fee_cents, o.seller_net_cents,
	o.discount_cents, o.tax_cents, o.charged_cents, o.tracking_number, o.carrier,
	o.shipped_at, o.delivered_at, o.claim_deadline, o.released_at, o.created_at,
	o.stripe_payment_intent_id, o.shipping_preset, o.signature_required,
	o.provider_shipment_id, o.label_cost_cents, o.label_url
`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	err := row.Scan(
		&o.ID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.State, &o.Rail, &o.TierAtSale,
		&o.TierPctAtSale,
		&o.SubtotalCents, &o.ShippingCents, &o.SellerFeeCents, &o.SellerNetCents,
		&o.DiscountCents, &o.TaxCents, &o.ChargedCents, &o.TrackingNumber, &o.Carrier,
		&o.ShippedAt, &o.DeliveredAt, &o.ClaimDeadline, &o.ReleasedAt, &o.CreatedAt,
		&o.StripePaymentIntentID, &o.ShippingPreset, &o.SignatureRequired,
		&o.ProviderShipmentID, &o.LabelCostCents, &o.LabelURL,
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

// GetByChargeID looks up an order by the platform-side Stripe charge that
// paid for it — internal/chargeback's fallback lookup for a dispute webhook
// whose payload didn't have the PaymentIntent populated, since a Dispute is
// always tied to a Charge but only usually tied to a PaymentIntent.
func GetByChargeID(ctx context.Context, pool *pgxpool.Pool, chargeID string) (*Order, error) {
	row := pool.QueryRow(ctx, `
		select `+selectOrderColumns+`
		from orders o
		join order_items oi on oi.order_id = o.id
		where o.stripe_charge_id = $1
	`, chargeID)
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
