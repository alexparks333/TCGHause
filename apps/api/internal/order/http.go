package order

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

// requireParticipant checks the caller is either the order's buyer or
// seller — every handler in this file needs this before returning or
// mutating anything order-related, so a stray order id can't be probed for
// someone else's purchase details.
func requireParticipant(o *Order, callerID string) bool {
	return callerID == o.BuyerID || callerID == o.SellerID
}

// HandleGetForListing backs the order-status page — reads the order tied
// to a listing (via order_items' unique listing_id), visible only to that
// order's own buyer or seller. 404 if the listing was never paid for
// through the real Connect checkout path (a mock purchase, or one made
// before internal/order existed) — that's a real "no order to show," not a
// bug to report.
func HandleGetForListing(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if !requireParticipant(o, callerID) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(o)
	}
}

type addEvidenceRequest struct {
	Type EvidenceType `json:"type"`
	URL  string       `json:"url"`
}

// HandleAddEvidence records one evidence row after the client has already
// uploaded the file straight to Supabase Storage (same pattern as listing
// photos, CLAUDE.md §6.13) — this endpoint never touches the file itself,
// only the resulting URL. AddEvidence itself enforces seller-vs-buyer
// upload permissions per evidence type; this handler's own job is just
// confirming the caller is a participant in the order at all.
func HandleAddEvidence(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if !requireParticipant(o, callerID) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		var req addEvidenceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := AddEvidence(r.Context(), pool, o.ID, callerID, req.Type, req.URL); err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrNotParticipant):
				status = http.StatusForbidden
			case errors.Is(err, ErrUnknownEvidenceType):
				status = http.StatusBadRequest
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type shipRequest struct {
	Carrier        string `json:"carrier"`
	TrackingNumber string `json:"trackingNumber"`
}

// HandleShip is the seller's "mark as shipped" action — blocked
// (ErrEvidenceIncomplete) until the required photo evidence already exists,
// per design doc v2 §5.3.
func HandleShip(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		var req shipRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Carrier == "" || req.TrackingNumber == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := MarkShipped(r.Context(), pool, o.ID, callerID, req.Carrier, req.TrackingNumber); err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrNotSeller):
				status = http.StatusForbidden
			case errors.Is(err, ErrEvidenceIncomplete), errors.Is(err, ErrInvalidTransition):
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}

		refreshed, err := GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(refreshed)
	}
}

// HandleDevAdvance is the Transactions page's dev-only "advance" button —
// pushes an order exactly one step through the real shipping/delivery/
// claim-window flow (DevAdvance's own doc comment has the full reasoning).
// Registered unconditionally (cmd/api/main.go, same as every other
// dev-only route in this codebase) — AllowDevAdvance is what actually
// gates it, checked inside DevAdvance itself, not here.
func HandleDevAdvance(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		updated, err := DevAdvance(r.Context(), pool, paymentClient, o.ID, callerID)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrDevAdvanceDisabled), errors.Is(err, ErrNotParticipant):
				status = http.StatusForbidden
			case errors.Is(err, ErrNothingToAdvance), errors.Is(err, ErrInvalidTransition), errors.Is(err, ErrEvidenceIncomplete):
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(updated)
	}
}
