package shipping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"auctionhous-tcg/api/internal/address"
)

// PitneyBowesClient wraps Pitney Bowes' Shipping API for the
// tracked_envelope preset — First-Class Mail Letter with an Intelligent
// Mail Barcode (IMb), the mechanism eBay's own "Standard Envelope"
// program is built on. Verified real before building this: a genuine
// self-serve developer sandbox (no sales call, no credit card), real
// webhook support for tracking events, and the exact serviceId/parcelType
// parameters below confirmed against Pitney Bowes' own docs — unlike
// LetterTrack (no demonstrable API, manual-dashboard-only per real seller
// reviews) and Lob (wrong shape entirely — they print and mail generic
// content themselves, not track a physical object the seller mails).
//
// UNTESTED AGAINST A REAL SANDBOX: the exact auth endpoint path and
// shipment-request field names below are best-effort from Pitney Bowes'
// public docs, not verified live the way shippo.go's request/response
// shapes were (that took one real bug — the `rate` field turning out to
// be a plain string, not an object — found only by actually calling the
// API). Expect the same here once real sandbox credentials exist: treat
// every endpoint path and field name in this file as provisional until
// then.
type PitneyBowesClient struct {
	clientID     string
	clientSecret string
	// supabaseURL/serviceRoleKey are needed only to re-host the base64
	// label PDF Pitney Bowes returns inline (see storage.go's doc
	// comment) — this client is otherwise unconfigured (nil) without
	// them, same as every other required-credential pattern here.
	supabaseURL    string
	serviceRoleKey string
	hc             *http.Client

	mu          sync.Mutex
	token       string
	tokenExpiry time.Time
}

const pitneyBowesSandboxBaseURL = "https://api-sandbox.sendpro360.pitneybowes.com/shipping"

func NewPitneyBowesClient(clientID, clientSecret, supabaseURL, serviceRoleKey string) *PitneyBowesClient {
	if clientID == "" || clientSecret == "" || supabaseURL == "" || serviceRoleKey == "" {
		return nil
	}
	return &PitneyBowesClient{
		clientID:       clientID,
		clientSecret:   clientSecret,
		supabaseURL:    supabaseURL,
		serviceRoleKey: serviceRoleKey,
		hc:             &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *PitneyBowesClient) IsConfigured() bool {
	return c != nil
}

// accessToken returns a cached OAuth2 client-credentials bearer token,
// refreshing it once it's within a minute of expiring. Pitney Bowes'
// docs describe client-credentials OAuth2 (exchange Client ID/Secret for
// a bearer token via an Authentication endpoint) but don't publish the
// exact token endpoint path in the material available at build time —
// PitneyBowesAuthURL below is a placeholder for that reason, needs
// confirming against the real developer portal docs once credentials
// exist.
const pitneyBowesAuthURL = pitneyBowesSandboxBaseURL + "/v1/oauth/token"

func (c *PitneyBowesClient) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Now().Before(c.tokenExpiry.Add(-1*time.Minute)) {
		return c.token, nil
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pitneyBowesAuthURL, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build pitney bowes auth request: %w", err)
	}
	req.SetBasicAuth(c.clientID, c.clientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("pitney bowes auth request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read pitney bowes auth response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("pitney bowes auth returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("decode pitney bowes auth response: %w", err)
	}

	c.token = tokenResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	return c.token, nil
}

type pitneyBowesAddress struct {
	Name          string `json:"name"`
	AddressLine1  string `json:"addressLine1"`
	AddressLine2  string `json:"addressLine2,omitempty"`
	CityTown      string `json:"cityTown"`
	StateProvince string `json:"stateProvince"`
	PostalCode    string `json:"postalCode"`
	CountryCode   string `json:"countryCode"`
	Phone         string `json:"phone,omitempty"`
	Email         string `json:"email,omitempty"`
}

func toPitneyBowesAddress(a *address.Address, email string) pitneyBowesAddress {
	pa := pitneyBowesAddress{
		Name:          a.FullName,
		AddressLine1:  a.Line1,
		CityTown:      a.City,
		StateProvince: a.State,
		PostalCode:    a.PostalCode,
		CountryCode:   a.Country,
		Email:         email,
	}
	if a.Line2 != nil {
		pa.AddressLine2 = *a.Line2
	}
	if a.Phone != nil {
		pa.Phone = *a.Phone
	}
	return pa
}

type pitneyBowesShipmentResponse struct {
	ShipmentID string `json:"shipmentId"`
	Parcel     struct {
		TrackingNumber string `json:"trackingNumber"`
	} `json:"parcel"`
	Rates []struct {
		Carrier    string  `json:"carrier"`
		ServiceId  string  `json:"serviceId"`
		BaseCharge float64 `json:"baseCharge"`
	} `json:"rates"`
	Documents []struct {
		Type        string `json:"type"`
		ContentType string `json:"contentType"`
		Data        string `json:"data"` // base64-encoded label artwork per PB's Create Shipment response shape
	} `json:"documents"`
}

// BuyLabel creates a First-Class Mail Letter shipment with an Intelligent
// Mail Barcode — serviceId "FCM", parcelType "NMLETTER" (non-machinable —
// what a semi-rigid card saver actually requires; using plain "LETTER"
// would misdeclare a rigid mailpiece as flexible letter mail, the exact
// mistake CLAUDE.md's packaging research flagged). No specialServices
// array: Pitney Bowes' own docs are explicit that IMb labels don't
// support extra services, which is also why signature confirmation is
// never offered on this mechanism — that requirement always upgrades an
// order to the Shippo/package mechanism instead (see preset.go's
// UpgradePreset).
func (c *PitneyBowesClient) BuyLabel(ctx context.Context, from, to *address.Address, fromEmail, toEmail string) (*Label, error) {
	token, err := c.accessToken(ctx)
	if err != nil {
		return nil, err
	}

	shipmentReq := map[string]any{
		"fromAddress": toPitneyBowesAddress(from, fromEmail),
		"toAddress":   toPitneyBowesAddress(to, toEmail),
		"parcel": map[string]any{
			"parcelType": "NMLETTER",
		},
		"rates": []map[string]any{
			{"carrier": "USPS", "serviceId": "FCM"},
		},
		"documents": []map[string]any{
			{"type": "SHIPPING_LABEL", "contentType": "PDF", "size": "DOC_4X6"},
		},
	}

	var shipment pitneyBowesShipmentResponse
	if err := c.post(ctx, token, "/v1/shipments", shipmentReq, &shipment); err != nil {
		return nil, fmt.Errorf("create pitney bowes shipment: %w", err)
	}

	if shipment.Parcel.TrackingNumber == "" {
		return nil, fmt.Errorf("shipping: pitney bowes shipment succeeded but no tracking number was returned")
	}
	var labelData string
	for _, doc := range shipment.Documents {
		if doc.Type == "SHIPPING_LABEL" {
			labelData = doc.Data
			break
		}
	}
	if labelData == "" {
		return nil, fmt.Errorf("shipping: pitney bowes shipment succeeded but no label document was returned")
	}

	labelURL, err := uploadLabelPDF(ctx, c.supabaseURL, c.serviceRoleKey, shipment.ShipmentID+".pdf", labelData)
	if err != nil {
		return nil, fmt.Errorf("host pitney bowes label: %w", err)
	}

	var costCents int64
	if len(shipment.Rates) > 0 {
		costCents = int64(shipment.Rates[0].BaseCharge * 100)
	} else {
		costCents = TrackedEnvelopeCents
	}

	return &Label{
		TrackingNumber:     shipment.Parcel.TrackingNumber,
		Carrier:            "USPS",
		Service:            "First-Class Mail (Tracked Envelope)",
		LabelURL:           labelURL,
		CostCents:          costCents,
		ProviderShipmentID: shipment.ShipmentID,
	}, nil
}

func (c *PitneyBowesClient) post(ctx context.Context, token, path string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pitneyBowesSandboxBaseURL+path, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("pitney bowes request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("pitney bowes returned %d: %s", resp.StatusCode, string(respBody))
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
