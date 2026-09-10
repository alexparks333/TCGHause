package auction

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/platform"
)

type placeBidRequest struct {
	MaxBidCents int64 `json:"maxBidCents"`
}

func HandlePlaceBid(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bidderID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req placeBidRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.MaxBidCents <= 0 {
			http.Error(w, "maxBidCents must be positive", http.StatusBadRequest)
			return
		}

		result, err := PlaceBid(r.Context(), pool, r.PathValue("id"), bidderID, req.MaxBidCents)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrAuctionNotFound):
				status = http.StatusNotFound
			case errors.Is(err, ErrAuctionEnded), errors.Is(err, ErrBidTooLow), errors.Is(err, ErrConflict):
				status = http.StatusConflict
			case errors.Is(err, ErrSelfBid):
				status = http.StatusForbidden
			}
			http.Error(w, err.Error(), status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

type endListingRequest struct {
	// Action/Reason only matter for a bid-having auction — see EndListing's
	// own doc comment. A fixed-price listing or a never-bid-on auction
	// sends an empty body, which decodes to this struct's zero value and
	// is never looked at.
	Action EndListingAction `json:"action"`
	Reason EndListingReason `json:"reason"`
}

// HandleEndListing serves DELETE /listings/{id} — the Selling page's
// "Delete Listing." Replaced listing.HandleCancel as this route's handler:
// deleting a listing is now an auction-aware decision (EndListing), not
// just a listing-status flip, once there's a real bid to account for.
func HandleEndListing(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req endListingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		err := EndListing(r.Context(), pool, r.PathValue("id"), sellerID, req.Action, req.Reason)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, listing.ErrNotFound):
				status = http.StatusNotFound
			case errors.Is(err, listing.ErrNotOwner):
				status = http.StatusForbidden
			case errors.Is(err, listing.ErrNotActive), errors.Is(err, ErrTooCloseToEnd):
				status = http.StatusConflict
			case errors.Is(err, ErrActionRequired), errors.Is(err, ErrInvalidReason):
				status = http.StatusBadRequest
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
