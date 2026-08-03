package auction

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

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
