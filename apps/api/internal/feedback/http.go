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
	ListingID         string `json:"listingId"`
	ConditionAccuracy int    `json:"conditionAccuracy"`
	ShippingSpeed     int    `json:"shippingSpeed"`
	Trustworthiness   int    `json:"trustworthiness"`
	Comment           string `json:"comment"`
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
		if in.ListingID == "" {
			http.Error(w, "listingId is required", http.StatusBadRequest)
			return
		}

		rv, err := Upsert(r.Context(), pool, seller.ID, reviewerID, in.ListingID,
			in.ConditionAccuracy, in.ShippingSpeed, in.Trustworthiness, in.Comment)
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

type replyInput struct {
	Reply string `json:"reply"`
}

// HandleReply lets a seller reply to one review of themselves —
// exactly one reply per review; posting again replaces it. The path
// carries both {username} and {reviewId} so the handler can confirm the
// caller *is* {username} before ever touching the review, rather than
// relying on AddReply's seller_id match alone to reject impersonation.
func HandleReply(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
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
		if seller.ID != callerID {
			http.Error(w, ErrNotYourReview.Error(), http.StatusForbidden)
			return
		}

		var in replyInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		rv, err := AddReply(r.Context(), pool, seller.ID, r.PathValue("reviewId"), in.Reply)
		if err != nil {
			switch {
			case errors.Is(err, ErrNotYourReview):
				http.Error(w, err.Error(), http.StatusForbidden)
			case errors.Is(err, ErrReviewNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
			case errors.Is(err, ErrReplyTooLong), errors.Is(err, ErrReplyRequired):
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

// HandleEligibleListings lets the frontend show exactly which purchases
// the caller can leave a new review against — an empty list means "can't
// review this seller at all" (never bought from them), same UX reasoning
// as checking username availability before signup submits, but also
// exactly what the review form's purchase picker needs to render.
func HandleEligibleListings(pool *pgxpool.Pool) http.HandlerFunc {
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

		listings := []EligibleListing{}
		if seller.ID != reviewerID {
			listings, err = EligibleListingsToReview(r.Context(), pool, seller.ID, reviewerID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string][]EligibleListing{"listings": listings})
	}
}
