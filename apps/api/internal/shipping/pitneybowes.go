package shipping

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"auctionhous-tcg/api/internal/address"
)

// PitneyBowesClient wraps Pitney Bowes' Shipping 360 API (the
// api-sandbox.sendpro360.pitneybowes.com platform — PB also runs a
// completely separate, older "Shipping APIs" platform at
// shipping-api-sandbox.pitneybowes.com with different endpoints/field
// names entirely, not what this integration uses) for the
// tracked_envelope preset — First-Class Mail Letter with an Intelligent
// Mail Barcode (IMb), the mechanism eBay's own "Standard Envelope"
// program is built on.
//
// VERIFIED LIVE against a real sandbox (2026-08-28) by actually calling
// the API and reading back real validation errors, then cross-checked
// against the real OpenAPI spec (docs.shipping360.pitneybowes.com/openapi/
// shipping — its rendered docs pages are JS/React and don't scrape
// directly, but the underlying spec is fetchable as plain JSON at
// page-data/shared/api-docs-openapi/shipping.yaml.json, which is what
// actually resolved the fields below instead of more guessing):
//   - OAuth token lives on a totally different host+path than every other
//     endpoint: .../auth/api/v1/token, not nested under /shipping at all.
//     Response is real OAuth2 shape (access_token/expires_in), but the
//     request is Basic auth + a plain JSON body, not form-urlencoded.
//   - Pitney Bowes support confirmed directly: Shipper ID is a legacy-API
//     concept and genuinely not needed for Shipping 360 — Developer ID +
//     these API credentials are sufficient. Confirmed independently too:
//     a fresh key generated from the live dashboard still authenticates
//     against this same entity, and Get Carrier Accounts (below) already
//     returns a real, usable USPS carrierAccountId with zero extra setup.
//   - The actual blocker was never account/credentials — it was the
//     request shape. Create Shipment lives at /shipping/api/v2/shipments
//     (v1 exists but has a different, narrower schema that has no way to
//     select a specific carrier account, which is why every v1 attempt
//     403'd with "unauthorized carrier account id in the request"
//     regardless of what was tried). v2 requires an explicit
//     "rateShopBy": "carrier" plus a "byCarrier": {carrierAccountId,
//     carrier, service} object — confirmed by pulling the real request
//     schema out of the OpenAPI spec directly, then verified with a full
//     successful live shipment (real shipmentId, USPS tracking number,
//     and a fetchable label URL) for a PKG/Priority Mail parcel.
//   - carrierAccountId is never hand-entered or hardcoded: GET
//     /shipping/api/v1/carrierAccounts (note the capital A — the
//     lowercase guess 404s) returns the account's own real, pre-
//     authorized carrier accounts. carrierAccountID() below caches this
//     the same way accessToken() caches the bearer token.
//   - Label output: labelType/labelSize/labelFormat/contentType are all
//     top-level request fields (not a "documents" array, which is a v1-
//     only shape). contentType "URL" is documented as valid specifically
//     for labelFormat PDF — the label comes back as a real fetchable URL,
//     not inline base64, so there's no re-hosting step needed here (same
//     as shippo.go's LabelURL — HandleDownloadLabel in label.go already
//     proxies whatever vendor URL is stored, generically).
//   - parcel fields are flat (weight/weightUnit/length/width/height/
//     dimUnit), not nested. GET /shipping/api/v1/parcelTypes?carrier=USPS
//     revealed NMLETTER's actual dimension rule — width (thickness) maxes
//     at 0.25in, height maxes at 6.13in — the opposite assignment from an
//     earlier, wrong guess that happened to pass validation anyway for
//     the (differently-constrained) PKG parcel type used to prove the
//     rest of this out.
//   - IMb (First-Class Mail Letter/NMLETTER) labels use a DIFFERENT
//     labelSize enum than every other parcel type: "DOC_6X4" (or
//     "DOC_9X4"), not the DOC_4X6/DOC_4X8/DOC_8X11 enum documented on
//     Create Shipment's own schema and confirmed working for parcelType
//     PKG. This is documented on a completely separate page (docs/
//     shipping/carriers/overview/usps, "IMb Label" section, surfaced by
//     Pitney Bowes support directly) rather than on Create Shipment's own
//     reference — the generic "Invalid label paper size" error gives no
//     hint that the valid-size set itself differs per parcel type. That
//     same page confirms no specialServices array and no
//     PRINT_CUSTOM_MESSAGE/PRINT_CUSTOM_MESSAGE_1 shipment options are
//     supported for FCM letters/flats, matching the no-specialServices
//     note on BuyLabel below. Verified end-to-end: real shipmentId, real
//     USPS tracking number, real fetchable label URL, $1.56 total charge
//     for the exact same NMLETTER/FCM parcel that 400'd under DOC_4X6.
type PitneyBowesClient struct {
	clientID     string
	clientSecret string
	hc           *http.Client

	mu          sync.Mutex
	token       string
	tokenExpiry time.Time

	accountMu          sync.Mutex
	uspsCarrierAccount string
}

const pitneyBowesSandboxBaseURL = "https://api-sandbox.sendpro360.pitneybowes.com/shipping/api"

func NewPitneyBowesClient(clientID, clientSecret string) *PitneyBowesClient {
	if clientID == "" || clientSecret == "" {
		return nil
	}
	return &PitneyBowesClient{
		clientID:     clientID,
		clientSecret: clientSecret,
		hc:           &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *PitneyBowesClient) IsConfigured() bool {
	return c != nil
}

// accessToken returns a cached OAuth2 client-credentials bearer token,
// refreshing it once it's within a minute of expiring. Confirmed live:
// this is Basic auth (Client ID as username, Secret as password) plus a
// plain `{"grant_type":"client_credentials"}` JSON body — NOT the
// form-urlencoded body an earlier, pre-sandbox guess used — and the token
// lives on its own host+path, entirely separate from
// pitneyBowesSandboxBaseURL.
const pitneyBowesAuthURL = "https://api-sandbox.sendpro360.pitneybowes.com/auth/api/v1/token"

func (c *PitneyBowesClient) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Now().Before(c.tokenExpiry.Add(-1*time.Minute)) {
		return c.token, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, pitneyBowesAuthURL, bytes.NewBufferString(`{"grant_type":"client_credentials"}`))
	if err != nil {
		return "", fmt.Errorf("build pitney bowes auth request: %w", err)
	}
	req.SetBasicAuth(c.clientID, c.clientSecret)
	req.Header.Set("Content-Type", "application/json")

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

// carrierAccountID returns this merchant's own USPS carrier account id,
// cached for the process lifetime (it's account-level configuration, not
// something that changes per-request). Confirmed live: GET
// /shipping/api/v1/carrierAccounts (capital A — the all-lowercase path
// 404s) is the real, documented way to discover this — never hand-enter
// or hardcode a carrierAccountId, and never confuse it with a Shipper ID
// (a legacy-API concept this platform doesn't use, per Pitney Bowes
// support directly).
func (c *PitneyBowesClient) carrierAccountID(ctx context.Context) (string, error) {
	c.accountMu.Lock()
	defer c.accountMu.Unlock()

	if c.uspsCarrierAccount != "" {
		return c.uspsCarrierAccount, nil
	}

	var resp struct {
		CarrierAccounts []struct {
			CarrierAccountID string `json:"carrierAccountId"`
			CarrierName      string `json:"carrierName"`
		} `json:"carrierAccounts"`
	}
	if err := c.get(ctx, "/v1/carrierAccounts", &resp); err != nil {
		return "", fmt.Errorf("get pitney bowes carrier accounts: %w", err)
	}
	for _, acct := range resp.CarrierAccounts {
		if acct.CarrierName == "USPS" {
			c.uspsCarrierAccount = acct.CarrierAccountID
			return c.uspsCarrierAccount, nil
		}
	}
	return "", fmt.Errorf("shipping: no USPS carrier account configured on this pitney bowes merchant")
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

// VerifiedAddress is the result of a real USPS CASS-style address check
// (via Pitney Bowes' /v1/address/verify) — the same validation Create
// Shipment itself performs, but callable ahead of an actual (non-
// refundable, for the IMb tracked_envelope case — see BuyLabel's own doc
// comment) label purchase. Corrected is true when Pitney Bowes normalized
// something (a fixed ZIP+4, expanded abbreviation, corrected casing) —
// confirmed live: an intentionally-wrong ZIP for a real Austin street
// still resolved to that street's correct ZIP+4, with status flipping
// from "VALIDATED_AND_NOT_CHANGED" to "VALIDATED_CHANGED" specifically to
// signal that.
type VerifiedAddress struct {
	Valid       bool
	Corrected   bool
	Normalized  *address.Address
	ErrorReason string
}

type pitneyBowesVerifyRequest struct {
	AddressLine1  string `json:"addressLine1"`
	AddressLine2  string `json:"addressLine2,omitempty"`
	CityTown      string `json:"cityTown"`
	StateProvince string `json:"stateProvince"`
	PostalCode    string `json:"postalCode"`
	CountryCode   string `json:"countryCode"`
}

type pitneyBowesVerifyResponse struct {
	AddressLine1  string `json:"addressLine1"`
	AddressLine2  string `json:"addressLine2"`
	CityTown      string `json:"cityTown"`
	StateProvince string `json:"stateProvince"`
	PostalCode    string `json:"postalCode"`
	CountryCode   string `json:"countryCode"`
	Status        string `json:"status"`
}

// VerifyAddress checks a from/to address against USPS's real address
// database before it's ever used to buy a label — never a live shipment
// purchase itself, so a seller correcting a typo doesn't risk the
// non-refundable-IMb-label problem BuyLabel's own doc comment describes.
// On success it returns the CASS-normalized address (which BuyLabel
// itself would silently apply anyway — e.g. bare "78701" becomes
// "78701-2539" — surfacing it here lets a caller show "we adjusted this"
// before committing, rather than after). Errors carry Pitney Bowes'
// own additionalInfo message (confirmed live to already be human-
// readable, e.g. "E412 - The delivery information does not match data
// for this city.") rather than the full raw validation_error JSON blob
// BuyLabel's own errors surface today.
func (c *PitneyBowesClient) VerifyAddress(ctx context.Context, a address.Address) (*VerifiedAddress, error) {
	req := pitneyBowesVerifyRequest{
		AddressLine1:  a.Line1,
		CityTown:      a.City,
		StateProvince: a.State,
		PostalCode:    a.PostalCode,
		CountryCode:   a.Country,
	}
	if a.Line2 != nil {
		req.AddressLine2 = *a.Line2
	}

	var resp pitneyBowesVerifyResponse
	err := c.post(ctx, "/v1/address/verify", req, &resp)
	if err != nil {
		var pbErr *pitneyBowesAPIError
		if errors.As(err, &pbErr) && len(pbErr.Errors) > 0 {
			return &VerifiedAddress{Valid: false, ErrorReason: pbErr.Errors[0].AdditionalInfo}, nil
		}
		return nil, fmt.Errorf("verify pitney bowes address: %w", err)
	}

	normalized := a
	normalized.Line1 = resp.AddressLine1
	if resp.AddressLine2 != "" {
		normalized.Line2 = &resp.AddressLine2
	}
	normalized.City = resp.CityTown
	normalized.State = resp.StateProvince
	normalized.PostalCode = resp.PostalCode
	normalized.Country = resp.CountryCode

	return &VerifiedAddress{
		Valid:      true,
		Corrected:  resp.Status != "VALIDATED_AND_NOT_CHANGED",
		Normalized: &normalized,
	}, nil
}

// pitneyBowesShipmentResponse is confirmed live against a real successful
// shipment (parcelType PKG / service PM) — every field below, including
// the flat (not nested-under-parcel) parcelTrackingNumber and the
// singular (not plural/array) rate object, matches that real response
// byte-for-byte. labelLayout.contents is a fetchable URL string when the
// request's contentType was "URL" (this client always requests that) —
// no base64 decoding or re-hosting needed, same as shippo.go's LabelURL.
type pitneyBowesShipmentResponse struct {
	ShipmentID           string `json:"shipmentId"`
	ParcelTrackingNumber string `json:"parcelTrackingNumber"`
	LabelLayout          []struct {
		ContentType string `json:"contentType"`
		Contents    string `json:"contents"`
		FileFormat  string `json:"fileFormat"`
		Type        string `json:"type"`
	} `json:"labelLayout"`
	Rate struct {
		Carrier            string  `json:"carrier"`
		ServiceID          string  `json:"serviceId"`
		BaseCharge         float64 `json:"baseCharge"`
		TotalCarrierCharge float64 `json:"totalCarrierCharge"`
	} `json:"rate"`
}

// BuyLabel creates a First-Class Mail Letter shipment with an Intelligent
// Mail Barcode — service "FCM", parcelType "NMLETTER" (non-machinable —
// what a semi-rigid card saver actually requires; using plain "LETTER"
// would misdeclare a rigid mailpiece as flexible letter mail, the exact
// mistake CLAUDE.md's packaging research flagged, and confirmed live: a
// LETTER-vs-NMLETTER sandbox rate quote for the same parcel showed
// NMLETTER carrying a real +$0.49 "nonmachinable" surcharge). No
// specialServices array: Pitney Bowes' own docs are explicit that IMb
// labels don't support extra services, which is also why signature
// confirmation is never offered on this mechanism — that requirement
// always upgrades an order to the Shippo/package mechanism instead (see
// preset.go's UpgradePreset).
//
// parcel dimensions below (width=thickness, height=the envelope's long
// edge) match NMLETTER's real dimension rule from GET
// /shipping/api/v1/parcelTypes?carrier=USPS: width (thickness) <= 0.25in,
// height <= 6.13in — confirmed live, and the opposite assignment from an
// easy-to-make mistake (assuming "width"/"height" name ordinary
// length/width the way a box would).
//
// labelSize "DOC_6X4" (not the DOC_4X6 that works for every other parcel
// type) is required specifically for IMb/NMLETTER labels — see the
// package-level doc comment for how this was found. Verified end-to-end:
// real shipmentId, real USPS tracking number, real fetchable label URL.
func (c *PitneyBowesClient) BuyLabel(ctx context.Context, from, to *address.Address, fromEmail, toEmail string) (*Label, error) {
	carrierAccountID, err := c.carrierAccountID(ctx)
	if err != nil {
		return nil, err
	}

	shipmentReq := map[string]any{
		"fromAddress": toPitneyBowesAddress(from, fromEmail),
		"toAddress":   toPitneyBowesAddress(to, toEmail),
		"parcel": map[string]any{
			// A card in a top loader/card saver inside a small envelope —
			// well within USPS's non-machinable letter size/weight limits.
			"weight":     2,
			"weightUnit": "OZ",
			"length":     6,
			"width":      0.25,
			"height":     4.25,
			"dimUnit":    "IN",
		},
		"parcelType": "NMLETTER",
		"rateShopBy": "carrier",
		"byCarrier": map[string]any{
			"carrierAccountId": carrierAccountID,
			"carrier":          "USPS",
			"service":          "FCM",
		},
		"labelType":   "SHIPPING_LABEL",
		"labelSize":   "DOC_6X4",
		"labelFormat": "PDF",
		"contentType": "URL",
	}

	var shipment pitneyBowesShipmentResponse
	if err := c.post(ctx, "/v2/shipments", shipmentReq, &shipment); err != nil {
		return nil, friendlyPitneyBowesError(err, "create pitney bowes shipment")
	}

	if shipment.ParcelTrackingNumber == "" {
		return nil, fmt.Errorf("shipping: pitney bowes shipment succeeded but no tracking number was returned")
	}
	var labelURL string
	for _, doc := range shipment.LabelLayout {
		if doc.Type == "SHIPPING_LABEL" {
			labelURL = doc.Contents
			break
		}
	}
	if labelURL == "" {
		return nil, fmt.Errorf("shipping: pitney bowes shipment succeeded but no label document was returned")
	}

	costCents := int64(shipment.Rate.TotalCarrierCharge * 100)
	if costCents == 0 {
		costCents = TrackedEnvelopeCents
	}

	return &Label{
		TrackingNumber:     shipment.ParcelTrackingNumber,
		Carrier:            "USPS",
		Service:            "First-Class Mail (Tracked Envelope)",
		LabelURL:           labelURL,
		CostCents:          costCents,
		ProviderShipmentID: shipment.ShipmentID,
	}, nil
}

// get and post fetch their own bearer token rather than taking one from the
// caller, specifically so they can retry once on a 401: Pitney Bowes'
// sandbox has been observed live to reject a still-unexpired cached token
// (our own tokenExpiry bookkeeping said it was good for another ~4 hours,
// the API said otherwise) — found live via a real "verify pitney bowes
// address: pitney bowes returned 401: {"message":"Unauthorized"}" that a
// fresh curl with a brand-new token, seconds later, did not reproduce. A
// bad cached token used to mean every call failed until the process
// restarted; now a 401 clears the cache and re-authenticates once before
// giving up.
func (c *PitneyBowesClient) get(ctx context.Context, path string, out any) error {
	return c.authenticatedDo(ctx, http.MethodGet, path, nil, out)
}

func (c *PitneyBowesClient) post(ctx context.Context, path string, body any, out any) error {
	return c.authenticatedDo(ctx, http.MethodPost, path, body, out)
}

func (c *PitneyBowesClient) authenticatedDo(ctx context.Context, method, path string, body any, out any) error {
	var bodyBytes []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		bodyBytes = b
	}

	send := func(token string) error {
		var reader io.Reader
		if bodyBytes != nil {
			reader = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequestWithContext(ctx, method, pitneyBowesSandboxBaseURL+path, reader)
		if err != nil {
			return fmt.Errorf("build request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if bodyBytes != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		return c.do(req, out)
	}

	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	err = send(token)
	var apiErr *pitneyBowesAPIError
	if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusUnauthorized {
		c.mu.Lock()
		c.token = ""
		c.mu.Unlock()
		token, err = c.accessToken(ctx)
		if err != nil {
			return err
		}
		return send(token)
	}
	return err
}

func (c *PitneyBowesClient) do(req *http.Request, out any) error {
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
		apiErr := &pitneyBowesAPIError{StatusCode: resp.StatusCode, Body: string(respBody)}
		var parsed struct {
			Errors []pitneyBowesErrorDetail `json:"errors"`
		}
		if json.Unmarshal(respBody, &parsed) == nil {
			apiErr.Errors = parsed.Errors
		}
		return apiErr
	}
	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

// pitneyBowesAPIError preserves the exact same .Error() string every
// existing caller (BuyLabel, carrierAccountID) already surfaces —
// wrapping it with fmt.Errorf("...: %w", err) produces byte-identical
// output to the plain-string error this replaced — while additionally
// letting VerifyAddress extract the structured error via errors.As,
// rather than needing to parse Pitney Bowes' raw JSON error blob back out
// of a formatted string.
type pitneyBowesAPIError struct {
	StatusCode int
	Body       string
	Errors     []pitneyBowesErrorDetail
}

func (e *pitneyBowesAPIError) Error() string {
	return fmt.Sprintf("pitney bowes returned %d: %s", e.StatusCode, e.Body)
}

type pitneyBowesErrorDetail struct {
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
	AdditionalCode   string `json:"additionalCode"`
	// AdditionalInfo is confirmed live to already be a human-readable
	// message in practice (e.g. "E412 - The delivery information does not
	// match data for this city."), unlike ErrorDescription (often just a
	// generic "Invalid address provided.") — VerifyAddress surfaces this
	// field specifically, not the whole error object.
	AdditionalInfo string `json:"additionalInfo"`
}

// friendlyPitneyBowesError extracts the one human-readable line out of a
// pitneyBowesAPIError's first error detail, rather than surfacing the
// full raw JSON error array to a caller (and, eventually, straight onto
// the page — found live: a real "E412" address mismatch showed up as an
// unformatted JSON blob under the "Buy Shipping Label" button). Falls
// back to the original wrapped error for anything that isn't this
// specific shape (network failures, decode errors, etc.), so this never
// hides information the raw error would have carried.
func friendlyPitneyBowesError(err error, action string) error {
	var pbErr *pitneyBowesAPIError
	if errors.As(err, &pbErr) && len(pbErr.Errors) > 0 && pbErr.Errors[0].AdditionalInfo != "" {
		return fmt.Errorf("%s: %s", action, pbErr.Errors[0].AdditionalInfo)
	}
	return fmt.Errorf("%s: %w", action, err)
}
