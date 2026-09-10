package shipping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"auctionhous-tcg/api/internal/address"
)

// Client wraps Shippo's REST API for real label purchase
// (docs/Shipping_Research.md §1/§5) — the fallback vendor from that
// research, promoted to primary after EasyPost's account-verification wall
// never cleared despite repeated support contact (see this feature's own
// history). Shippo has no official Go SDK, so this is a plain net/http
// client against api.goshippo.com rather than a wrapped library — the
// vendor-specific surface stays entirely inside this file; nothing outside
// internal/shipping knows or cares which HTTP calls actually happen. Nil
// when SHIPPO_API_TOKEN isn't set — same graceful-degradation pattern as
// every other optional integration in this codebase.
type Client struct {
	token string
	hc    *http.Client
}

const shippoBaseURL = "https://api.goshippo.com"

func NewClient(apiToken string) *Client {
	if apiToken == "" {
		return nil
	}
	return &Client{token: apiToken, hc: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) IsConfigured() bool {
	return c != nil
}

// parcelFor is the platform's default packaging per preset
// (docs/Shipping_Research.md §4's minimum standard): a snug bubble mailer
// with a top-loader/cardboard-stay protective guard for the common case,
// a small rigid box for PresetFreeBox shipments (graded slabs, per that
// doc's "container choice should scale with value" finding). Dimensions
// in inches, weight in ounces — Shippo's parcel object. Only ever called
// for package-mechanism presets (free_bubble_mailer, free_box,
// shippo_ground_advantage) — envelope-mechanism presets never reach
// Shippo at all.
func parcelFor(preset Preset) shippoParcel {
	if preset == PresetFreeBox {
		return shippoParcel{Length: "8", Width: "6", Height: "2", DistanceUnit: "in", Weight: "12", MassUnit: "oz"}
	}
	return shippoParcel{Length: "9", Width: "6", Height: "0.75", DistanceUnit: "in", Weight: "3", MassUnit: "oz"}
}

type shippoParcel struct {
	Length       string `json:"length"`
	Width        string `json:"width"`
	Height       string `json:"height"`
	DistanceUnit string `json:"distance_unit"`
	Weight       string `json:"weight"`
	MassUnit     string `json:"mass_unit"`
}

type shippoAddress struct {
	Name    string `json:"name"`
	Street1 string `json:"street1"`
	Street2 string `json:"street2,omitempty"`
	City    string `json:"city"`
	State   string `json:"state"`
	Zip     string `json:"zip"`
	Country string `json:"country"`
	Phone   string `json:"phone,omitempty"`
	// Email is required by Shippo (discovered live: "Attribute
	// address_from.email must not be empty") — not something
	// internal/address stores on the address book itself (that's shipping
	// PII, an account email is identity), so callers pass the account's own
	// email in separately rather than this package reaching into
	// internal/user itself.
	Email string `json:"email,omitempty"`
}

func toShippoAddress(a *address.Address, email string) shippoAddress {
	sa := shippoAddress{
		Name:    a.FullName,
		Street1: a.Line1,
		City:    a.City,
		State:   a.State,
		Zip:     a.PostalCode,
		Country: a.Country,
		Email:   email,
	}
	if a.Line2 != nil {
		sa.Street2 = *a.Line2
	}
	if a.Phone != nil {
		sa.Phone = *a.Phone
	}
	return sa
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
	ProviderShipmentID string
}

type shippoRate struct {
	ObjectID     string `json:"object_id"`
	Amount       string `json:"amount"`
	Provider     string `json:"provider"`
	Servicelevel struct {
		Name string `json:"name"`
	} `json:"servicelevel"`
}

type shippoShipmentResponse struct {
	ObjectID string       `json:"object_id"`
	Status   string       `json:"status"`
	Messages []shippoMsg  `json:"messages"`
	Rates    []shippoRate `json:"rates"`
}

type shippoMsg struct {
	Source string `json:"source"`
	Code   string `json:"code"`
	Text   string `json:"text"`
}

// Rate is the rate object_id as a plain string here (unlike the expanded
// shippoRate objects in a Shipment's Rates list) — Shippo doesn't expand it
// on a Transaction by default. Unused below; the already-fetched `best`
// rate (Provider/Servicelevel/Amount) from the shipment step is what backs
// the returned Label, not anything re-read off the transaction.
type shippoTransactionResponse struct {
	ObjectID       string      `json:"object_id"`
	Status         string      `json:"status"`
	TrackingNumber string      `json:"tracking_number"`
	LabelURL       string      `json:"label_url"`
	Messages       []shippoMsg `json:"messages"`
	Rate           string      `json:"rate"`
}

var ErrNoRatesAvailable = fmt.Errorf("shipping: no carrier rates were available for this shipment")

// rateShop creates a Shippo shipment from the seller's address to the
// buyer's and rate-shops across every carrier Shippo returns — shared by
// BuyLabel (which then purchases the cheapest rate) and QuoteRate (which
// only needs the price, for a listing's one-time shipping-cost estimate).
// USPS Ground Advantage wins this comparison for AuctionHous's weight
// class in practice (docs/Shipping_Research.md §3 found UPS isn't
// cost-competitive under ~1lb), but nothing here hardcodes a carrier; the
// real-time rate-shop is the source of truth, not a documented assumption.
// signatureRequired requests signature confirmation at shipment-creation
// time (extra.signature_confirmation) — the $500+ policy's objective,
// carrier-verified evidence bar (see preset.go's doc comment) — passed
// explicitly rather than derived from preset, since a free_bubble_mailer
// or free_box order can cross that threshold too.
func (c *Client) rateShop(ctx context.Context, from, to *address.Address, fromEmail, toEmail string, preset Preset, signatureRequired bool) (*shippoRate, error) {
	shipmentReq := map[string]any{
		"address_from": toShippoAddress(from, fromEmail),
		"address_to":   toShippoAddress(to, toEmail),
		"parcels":      []shippoParcel{parcelFor(preset)},
		"async":        false,
	}
	if signatureRequired {
		shipmentReq["extra"] = map[string]any{"signature_confirmation": "STANDARD"}
	}

	var shipment shippoShipmentResponse
	if err := c.post(ctx, "/shipments/", shipmentReq, &shipment); err != nil {
		return nil, fmt.Errorf("create shippo shipment: %w", err)
	}

	best := lowestRate(shipment.Rates)
	if best == nil {
		return nil, ErrNoRatesAvailable
	}
	return best, nil
}

// QuoteRate returns the cheapest available rate's cost without buying
// anything. Two callers, two different meanings of `to`/signatureRequired:
// internal/listing.Create uses this for a listing's one-time estimate
// against shipping.ReferenceAddress (never the real buyer, unknown at
// listing time, so always signatureRequired=false there — the final price
// isn't known yet either); HandleCreateCheckoutIntent (checkout.go) uses
// this at checkout time with the real buyer's real address and the real
// resolved signatureRequired, which is what makes that call an actual
// quote rather than an estimate.
func (c *Client) QuoteRate(ctx context.Context, from, to *address.Address, fromEmail, toEmail string, preset Preset, signatureRequired bool) (int64, error) {
	best, err := c.rateShop(ctx, from, to, fromEmail, toEmail, preset, signatureRequired)
	if err != nil {
		return 0, err
	}
	return centsFromDollarString(best.Amount)
}

// ChargedCentsLive is ChargedCents' checkout-time counterpart — the fix for
// the gap ChargedCents' own doc comment names: a buyer charged whatever a
// listing's one-time estimate said, while the seller's real label (bought
// later, against the real buyer address) could cost more or less. This is
// exactly how eBay's own "calculated shipping" works: the listing page
// shows an estimate against a generic reference point, but the number
// shown for actual payment is a live rate-shop against the real buyer
// address — and that's the number that gets charged, not a second, still
// different number, so there's no post-payment surprise (see this
// feature's own history for the research this was built from).
//
// Falls back to ChargedCents' frozen estimate whenever a live quote isn't
// actually possible — Shippo not configured, either address missing (e.g.
// the buyer hasn't saved a shipping address yet), or the rate-shop call
// itself fails — same graceful-degradation shape as every other optional
// integration in this codebase. A shipping-quote hiccup must never block
// checkout; the buyer just sees the old estimate-based number instead,
// exactly as before this existed.
func ChargedCentsLive(ctx context.Context, shippoClient *Client, preset Preset, from, to *address.Address, fromEmail, toEmail string, signatureRequired bool, estimatedShippingCents *int64) int64 {
	if preset.IsFree() || preset == PresetTrackedEnvelope {
		return ChargedCents(preset, estimatedShippingCents)
	}
	if shippoClient == nil || !shippoClient.IsConfigured() || from == nil || to == nil {
		return ChargedCents(preset, estimatedShippingCents)
	}
	cents, err := shippoClient.QuoteRate(ctx, from, to, fromEmail, toEmail, preset, signatureRequired)
	if err != nil {
		log.Printf("shipping: live rate-shop failed, falling back to listing estimate: %v", err)
		return ChargedCents(preset, estimatedShippingCents)
	}
	return cents
}

// BuyLabel rate-shops (via rateShop) and buys the cheapest rate.
func (c *Client) BuyLabel(ctx context.Context, from, to *address.Address, fromEmail, toEmail string, preset Preset, signatureRequired bool) (*Label, error) {
	best, err := c.rateShop(ctx, from, to, fromEmail, toEmail, preset, signatureRequired)
	if err != nil {
		return nil, err
	}

	var tx shippoTransactionResponse
	buyReq := map[string]any{
		"rate":            best.ObjectID,
		"label_file_type": "PDF",
		"async":           false,
	}
	if err := c.post(ctx, "/transactions/", buyReq, &tx); err != nil {
		return nil, fmt.Errorf("buy shippo transaction: %w", err)
	}

	// async:false is documented to resolve synchronously, but Shippo can
	// still occasionally return QUEUED for some carriers — poll briefly
	// rather than assume the first response is final.
	for attempt := 0; tx.Status == "QUEUED" && attempt < 6; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(1 * time.Second):
		}
		if err := c.get(ctx, "/transactions/"+tx.ObjectID+"/", &tx); err != nil {
			return nil, fmt.Errorf("poll shippo transaction: %w", err)
		}
	}

	if tx.Status != "SUCCESS" || tx.LabelURL == "" {
		return nil, fmt.Errorf("shipping: label purchase did not succeed (status %q): %s", tx.Status, formatMessages(tx.Messages))
	}

	costCents, err := centsFromDollarString(best.Amount)
	if err != nil {
		return nil, fmt.Errorf("parse rate cost: %w", err)
	}

	return &Label{
		TrackingNumber:     tx.TrackingNumber,
		Carrier:            best.Provider,
		Service:            best.Servicelevel.Name,
		LabelURL:           tx.LabelURL,
		CostCents:          costCents,
		ProviderShipmentID: tx.ObjectID,
	}, nil
}

func lowestRate(rates []shippoRate) *shippoRate {
	var lowest *shippoRate
	var lowestCents int64
	for i := range rates {
		cents, err := centsFromDollarString(rates[i].Amount)
		if err != nil {
			continue
		}
		if lowest == nil || cents < lowestCents {
			lowest = &rates[i]
			lowestCents = cents
		}
	}
	return lowest
}

// centsFromDollarString parses Shippo's decimal-dollars-as-string amount
// field into pkg/money.Cents-shaped int64 — never float64 (CLAUDE.md §5.1).
func centsFromDollarString(amount string) (int64, error) {
	f, err := strconv.ParseFloat(amount, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount value %q: %w", amount, err)
	}
	return int64(math.Round(f * 100)), nil
}

func formatMessages(msgs []shippoMsg) string {
	if len(msgs) == 0 {
		return "no additional detail from Shippo"
	}
	out := ""
	for i, m := range msgs {
		if i > 0 {
			out += "; "
		}
		out += m.Text
	}
	return out
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, nil, out)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, shippoBaseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "ShippoToken "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("shippo request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("shippo returned %d: %s", resp.StatusCode, string(respBody))
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
