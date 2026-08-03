package feedback

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

// HandleListForSeller backs a seller's public profile page — public, no
// RequireAuth.
func HandleListForSeller(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		seller, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		summary, err := ListForSeller(r.Context(), pool, seller.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(summary)
	}
}

type upsertReviewInput struct {
	Rating  int    `json:"rating"`
	Comment string `json:"comment"`
}

func HandleUpsert(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reviewerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		seller, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var in upsertReviewInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		rv, err := Upsert(r.Context(), pool, seller.ID, reviewerID, in.Rating, in.Comment)
		if err != nil {
			switch {
			case errors.Is(err, ErrCannotReviewSelf), errors.Is(err, ErrNoPurchase):
				http.Error(w, err.Error(), http.StatusForbidden)
			case errors.Is(err, ErrInvalidRating), errors.Is(err, ErrCommentTooLong):
				http.Error(w, err.Error(), http.StatusBadRequest)
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rv)
	}
}

// HandleCanReview lets the frontend decide whether to even show the
// "leave a review" form before the caller tries and gets a 403 — same
// UX reasoning as checking username availability before signup submits.
func HandleCanReview(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reviewerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		seller, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		canReview := seller.ID != reviewerID
		if canReview {
			won, err := HasWonAuctionFrom(r.Context(), pool, seller.ID, reviewerID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			canReview = won
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"canReview": canReview})
	}
}
