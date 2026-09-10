package shipping

import (
	"encoding/json"
	"net/http"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/platform"
)

type verifyAddressResponse struct {
	Valid       bool             `json:"valid"`
	Corrected   bool             `json:"corrected"`
	Normalized  *address.Address `json:"normalized,omitempty"`
	ErrorReason string           `json:"errorReason,omitempty"`
}

// HandleVerifyAddress checks an address against USPS's real address
// database (via Pitney Bowes' /v1/address/verify — the same check Create
// Shipment itself performs) before it's ever used to save an Account
// Settings address or buy a label. Exists specifically because a real
// user hit "E412 - The delivery information does not match data for this
// city" on the one-time "ship from a different address" override
// (PrintLabelButton.tsx) after Pitney Bowes had already rejected the
// purchase outright — a purely-informational endpoint like this lets the
// frontend catch that before attempting a purchase at all, rather than
// after. Deliberately not scoped to a specific order/listing (unlike
// HandleBuyLabel) — any logged-in user can check any address they're
// about to save or ship from, including on the plain Account Settings
// form (AddressForm.tsx), not just the shipping-label override flow.
//
// Only Line1/Line2/City/State/PostalCode/Country matter here — FullName
// and Phone (required by address.Validate for an actual save) are
// irrelevant to whether USPS can deliver to this street address, so this
// endpoint never calls Validate, just Normalize (to catch a free-text
// "USA"-style country before it ever reaches Pitney Bowes).
func HandleVerifyAddress(pbClient *PitneyBowesClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := platform.UserIDFromContext(r.Context()); !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !pbClient.IsConfigured() {
			http.Error(w, "address verification is not configured", http.StatusServiceUnavailable)
			return
		}

		var a address.Address
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		a = address.Normalize(a)

		result, err := pbClient.VerifyAddress(r.Context(), a)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(verifyAddressResponse{
			Valid:       result.Valid,
			Corrected:   result.Corrected,
			Normalized:  result.Normalized,
			ErrorReason: result.ErrorReason,
		})
	}
}
