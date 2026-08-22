package shipping

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/platform"
)

type buyLabelResponse struct {
	TrackingNumber string `json:"trackingNumber"`
	Carrier        string `json:"carrier"`
	Service        string `json:"service"`
	LabelURL       string `json:"labelUrl"`
	CostCents      int64  `json:"costCents"`
}

// HandleBuyLabel is the seller's "get a shipping label" action — the actual
// capability the business asked for first (docs/Shipping_Research.md):
// rate-shop and buy a real EasyPost label for this order, using the tier
// (standard/tracked/signature) already snapshotted on the order at
// order.CreateFromWin time, then record the result. Deliberately does NOT
// transition the order's state itself — MarkShipped (still gated on the
// design doc v2 §5.3 photo evidence) does that; the frontend is expected to
// call this first, then call MarkShipped with the carrier/tracking number
// this returns.
func HandleBuyLabel(pool *pgxpool.Pool, client *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !client.IsConfigured() {
			http.Error(w, "shipping label purchase is not configured", http.StatusServiceUnavailable)
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

		// The order's own snapshot (order.CreateFromWin) is the source of
		// truth for which tier this shipment must satisfy — never re-derive
		// from the listing's preset here, since that's exactly the stale
		// value CreateFromWin's Max() call already accounted for.
		tier := TierStandard
		if o.ShippingTier != nil && Tier(*o.ShippingTier).Valid() {
			tier = Tier(*o.ShippingTier)
		}

		label, err := client.BuyLabel(r.Context(), fromAddr, toAddr, tier)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		if err := order.SetLabel(r.Context(), pool, o.ID, callerID, label.Carrier, label.TrackingNumber, label.EasyPostShipmentID, label.LabelURL, label.CostCents); err != nil {
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
