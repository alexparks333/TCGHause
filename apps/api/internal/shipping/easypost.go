package shipping

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"

	easypost "github.com/EasyPost/easypost-go/v4"

	"auctionhous-tcg/api/internal/address"
)

// Client wraps the EasyPost SDK for real label purchase
// (docs/Shipping_Research.md §1/§5) — chosen over Shippo per that
// research's recommendation (best-documented no-printer QR flow, unified
// USPS+UPS API, free under 3,000 labels/month). Nil when
// EASYPOST_API_KEY isn't set — same graceful-degradation pattern as every
// other optional integration in this codebase (payment.Client,
// cardcatalog.Client): callers check IsConfigured() rather than failing to
// boot.
type Client struct {
	ep *easypost.Client
}

func NewClient(apiKey string) *Client {
	if apiKey == "" {
		return nil
	}
	return &Client{ep: easypost.New(apiKey)}
}

func (c *Client) IsConfigured() bool {
	return c != nil
}

// parcelFor is the platform's default packaging per tier
// (docs/Shipping_Research.md §4's minimum standard): a snug bubble mailer
// with a top-loader/cardboard-stay protective guard for the common
// standard/tracked case, a small rigid box for signature-tier shipments
// (graded slabs and $500+ raw cards, per that doc's "container choice
// should scale with value" finding). Dimensions in inches, weight in
// ounces — EasyPost's Parcel object.
func parcelFor(tier Tier) *easypost.Parcel {
	if tier == TierSignature {
		return &easypost.Parcel{Length: 8, Width: 6, Height: 2, Weight: 12}
	}
	return &easypost.Parcel{Length: 9, Width: 6, Height: 0.75, Weight: 3}
}

func toEasyPostAddress(a *address.Address) *easypost.Address {
	ep := &easypost.Address{
		Name:    a.FullName,
		Street1: a.Line1,
		City:    a.City,
		State:   a.State,
		Zip:     a.PostalCode,
		Country: a.Country,
	}
	if a.Line2 != nil {
		ep.Street2 = *a.Line2
	}
	if a.Phone != nil {
		ep.Phone = *a.Phone
	}
	return ep
}

// Label is a purchased shipment's result — what gets persisted onto an
// order (order.SetLabel) and returned to the seller for printing or QR
// display.
type Label struct {
	TrackingNumber     string
	Carrier            string
	Service            string
	LabelURL           string
	CostCents          int64
	EasyPostShipmentID string
}

var ErrNoRatesAvailable = errors.New("shipping: no carrier rates were available for this shipment")

// BuyLabel creates an EasyPost shipment from the seller's address to the
// buyer's, rate-shops across every carrier EasyPost returns, and buys the
// cheapest rate — USPS Ground Advantage wins this comparison for
// AuctionHous's weight class in practice (docs/Shipping_Research.md §3
// found UPS isn't cost-competitive under ~1lb), but nothing here hardcodes
// a carrier; the real-time rate-shop is the source of truth, not a
// documented assumption. TierSignature requests delivery confirmation via
// signature — the $500+ policy's objective, carrier-verified evidence bar
// (see tier.go's doc comment) — which EasyPost only returns/sells rates
// for on services that actually support it.
func (c *Client) BuyLabel(ctx context.Context, from, to *address.Address, tier Tier) (*Label, error) {
	shipment := &easypost.Shipment{
		FromAddress: toEasyPostAddress(from),
		ToAddress:   toEasyPostAddress(to),
		Parcel:      parcelFor(tier),
	}
	if tier == TierSignature {
		shipment.Options = &easypost.ShipmentOptions{DeliveryConfirmation: "SIGNATURE"}
	}

	created, err := c.ep.CreateShipmentWithContext(ctx, shipment)
	if err != nil {
		return nil, fmt.Errorf("create easypost shipment: %w", err)
	}

	best := lowestRate(created.Rates)
	if best == nil {
		return nil, ErrNoRatesAvailable
	}

	bought, err := c.ep.BuyShipmentWithContext(ctx, created.ID, best, "")
	if err != nil {
		return nil, fmt.Errorf("buy easypost shipment: %w", err)
	}
	if bought.PostageLabel == nil || bought.PostageLabel.LabelURL == "" {
		return nil, fmt.Errorf("shipping: label purchase succeeded but no label URL was returned")
	}

	costCents, err := centsFromRateString(best.Rate)
	if err != nil {
		return nil, fmt.Errorf("parse rate cost: %w", err)
	}

	return &Label{
		TrackingNumber:     bought.TrackingCode,
		Carrier:            best.Carrier,
		Service:            best.Service,
		LabelURL:           bought.PostageLabel.LabelURL,
		CostCents:          costCents,
		EasyPostShipmentID: bought.ID,
	}, nil
}

func lowestRate(rates []*easypost.Rate) *easypost.Rate {
	var lowest *easypost.Rate
	var lowestCents int64
	for _, r := range rates {
		cents, err := centsFromRateString(r.Rate)
		if err != nil {
			continue
		}
		if lowest == nil || cents < lowestCents {
			lowest = r
			lowestCents = cents
		}
	}
	return lowest
}

// centsFromRateString parses EasyPost's decimal-dollars-as-string rate
// field into pkg/money.Cents-shaped int64 — never float64 (CLAUDE.md §5.1).
func centsFromRateString(rate string) (int64, error) {
	f, err := strconv.ParseFloat(rate, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid rate value %q: %w", rate, err)
	}
	return int64(math.Round(f * 100)), nil
}
