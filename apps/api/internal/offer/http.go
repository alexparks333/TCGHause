package offer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

type submitRequest struct {
	AmountCents int64 `json:"amountCents"`
}

// HandleSubmit backs the buyer-facing "Make an Offer" button on a listing
// that has allow_offers set.
func HandleSubmit(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req submitRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		o, err := Submit(r.Context(), pool, userID, r.PathValue("id"), req.AmountCents)
		if err != nil {
			writeOfferError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(o)
	}
}

func HandleListReceived(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		offers, err := ListReceived(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(offers)
	}
}

func HandleListSent(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		offers, err := ListSent(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(offers)
	}
}

// HandleListForListing backs the seller's own listing page showing exactly
// the offers made on that listing — ListForListing itself enforces the
// caller actually is that listing's seller.
func HandleListForListing(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		offers, err := ListForListing(r.Context(), pool, r.PathValue("id"), userID)
		if err != nil {
			writeOfferError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(offers)
	}
}

func HandleAccept(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := Accept(r.Context(), pool, userID, r.PathValue("id"))
		if err != nil {
			writeOfferError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(o)
	}
}

func HandleDecline(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := Decline(r.Context(), pool, userID, r.PathValue("id"))
		if err != nil {
			writeOfferError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(o)
	}
}

func writeOfferError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, ErrNotParticipant):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, ErrOffersNotAllowed), errors.Is(err, ErrSelfOffer), errors.Is(err, ErrInvalidAmount),
		errors.Is(err, ErrBelowMinimum), errors.Is(err, ErrListingNotActive), errors.Is(err, ErrAlreadyPending),
		errors.Is(err, ErrNotPending):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, ErrListingUnavailable):
		http.Error(w, err.Error(), http.StatusConflict)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
