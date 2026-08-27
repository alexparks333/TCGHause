package shipping

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

type buyLabelResponse struct {
	TrackingNumber string `json:"trackingNumber"`
	Carrier        string `json:"carrier"`
	Service        string `json:"service"`
	LabelURL       string `json:"labelUrl"`
	CostCents      int64  `json:"costCents"`
}

// HandleBuyLabel is the seller's "get a shipping label" action — rate-shop
// and buy a real label for this order, then record the result.
// Deliberately does NOT transition the order's state itself — MarkShipped
// (still gated on the design doc v2 §5.3 photo evidence) does that; the
// frontend is expected to call this first, then call MarkShipped with the
// carrier/tracking number this returns.
//
// Dispatches to Shippo or Pitney Bowes based on the order's own snapshotted
// shipping_preset — never re-derived from the listing's current preset
// here, since that's exactly the stale value order.CreateFromWin's
// UpgradePreset call already resolved. This is also the mechanism-locking
// the product explicitly requires: a tracked_envelope order can only ever
// reach the Pitney Bowes branch below, a shippo_ground_advantage order
// only the Shippo branch — there's no path for a seller to buy one label
// type and have it recorded as the other.
func HandleBuyLabel(pool *pgxpool.Pool, shippoClient *Client, pbClient *PitneyBowesClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, order.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if callerID != o.SellerID {
			http.Error(w, "only the seller can buy a shipping label for this order", http.StatusForbidden)
			return
		}

		preset := PresetTrackedEnvelope
		if o.ShippingPreset != nil && Preset(*o.ShippingPreset).Valid() {
			preset = Preset(*o.ShippingPreset)
		}
		mechanism := preset.Mechanism()

		if mechanism == MechanismPackage && !shippoClient.IsConfigured() {
			http.Error(w, "shipping label purchase is not configured", http.StatusServiceUnavailable)
			return
		}
		if mechanism == MechanismLetter && !pbClient.IsConfigured() {
			http.Error(w, "tracked envelope label purchase is not configured", http.StatusServiceUnavailable)
			return
		}

		fromAddr, err := address.Get(r.Context(), pool, o.SellerID)
		if err != nil {
			if errors.Is(err, address.ErrNotFound) {
				http.Error(w, "add a return address in Account Settings before buying a label", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		toAddr, err := address.Get(r.Context(), pool, o.BuyerID)
		if err != nil {
			if errors.Is(err, address.ErrNotFound) {
				http.Error(w, "the buyer has no shipping address on file yet", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Both vendors require an email per address (discovered live with
		// Shippo) — the address book itself doesn't store one
		// (internal/address's own doc comment: that's shipping PII, not
		// identity), so pull each party's account email instead.
		fromUser, err := user.Get(r.Context(), pool, o.SellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		toUser, err := user.Get(r.Context(), pool, o.BuyerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var label *Label
		if mechanism == MechanismLetter {
			label, err = pbClient.BuyLabel(r.Context(), fromAddr, toAddr, fromUser.Email, toUser.Email)
		} else {
			label, err = shippoClient.BuyLabel(r.Context(), fromAddr, toAddr, fromUser.Email, toUser.Email, preset, o.SignatureRequired)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		if err := order.SetLabel(r.Context(), pool, o.ID, callerID, label.Carrier, label.TrackingNumber, label.ProviderShipmentID, label.LabelURL, label.CostCents); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(buyLabelResponse{
			TrackingNumber: label.TrackingNumber,
			Carrier:        label.Carrier,
			Service:        label.Service,
			LabelURL:       label.LabelURL,
			CostCents:      label.CostCents,
		})
	}
}

// HandleDownloadLabel proxies the order's already-purchased label PDF
// through our own backend rather than letting the frontend link straight
// to Shippo's signed URL — a plain cross-origin link there gets its
// `download` attribute silently ignored by the browser, so it opens the
// PDF viewer instead of downloading (the actual bug this fixes). Fetching
// server-side and replying with Content-Disposition: attachment forces a
// real download regardless of origin, and sidesteps needing Shippo's CDN to
// support CORS for a client-side fetch in the first place.
func HandleDownloadLabel(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, order.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if callerID != o.SellerID {
			http.Error(w, "only the seller can download this order's shipping label", http.StatusForbidden)
			return
		}
		if o.LabelURL == nil || *o.LabelURL == "" {
			http.Error(w, "no shipping label has been purchased for this order yet", http.StatusNotFound)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, *o.LabelURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "failed to fetch label: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("label host returned %d", resp.StatusCode), http.StatusBadGateway)
			return
		}

		filename := "shipping-label.pdf"
		if o.TrackingNumber != nil && *o.TrackingNumber != "" {
			filename = fmt.Sprintf("shipping-label-%s.pdf", *o.TrackingNumber)
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		io.Copy(w, resp.Body)
	}
}
