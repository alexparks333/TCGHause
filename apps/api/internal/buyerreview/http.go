package buyerreview

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

// HandleGetForListing returns the caller's own review of this order's
// buyer, or null if they haven't left one yet — the order page uses this to
// decide whether to show "leave a review" or the review already left.
// Listing-scoped in the URL to match every other order-adjacent route
// (internal/order, internal/shipping, internal/dispute all key off
// /listings/{id}/order/...) even though the lookup itself is by order id
// once resolved.
func HandleGetForListing(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, "order not found", http.StatusNotFound)
			return
		}
		if o.SellerID != callerID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		rv, err := GetForOrder(r.Context(), pool, o.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rv)
	}
}

type upsertInput struct {
	Rating  float64 `json:"rating"`
	Tag     string  `json:"tag"`
	Comment string  `json:"comment"`
}

// HandleUpsert lets the seller on this order rate its buyer. Authorization
// is enforced by Upsert's own soldTo check (orderID/sellerID/buyerID must
// match a real order), not just by resolving {id} to a listing — the
// caller's id is only ever used as the sellerID half of that check, so a
// non-seller caller always lands on ErrNotYourSale.
func HandleUpsert(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, "order not found", http.StatusNotFound)
			return
		}

		var in upsertInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		rv, err := Upsert(r.Context(), pool, o.ID, callerID, o.BuyerID, in.Rating, in.Tag, in.Comment)
		if err != nil {
			switch {
			case errors.Is(err, ErrCannotReviewSelf), errors.Is(err, ErrNotYourSale), errors.Is(err, ErrOrderNotComplete):
				http.Error(w, err.Error(), http.StatusForbidden)
			case errors.Is(err, ErrInvalidRating), errors.Is(err, ErrInvalidTag), errors.Is(err, ErrCommentTooLong):
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

// HandleStatsForUser backs OrderBuyerCard's stats/tag display — public,
// same as feedback.HandleListForSeller, since it's an aggregate reputation
// summary rather than anything private about one transaction.
func HandleStatsForUser(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := user.GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, user.ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		stats, err := StatsFor(r.Context(), pool, u.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	}
}
