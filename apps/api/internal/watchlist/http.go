package watchlist

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

type statusResponse struct {
	Watching     bool `json:"watching"`
	WatcherCount int  `json:"watcherCount"`
}

func respondStatus(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, userID, listingID string, watching bool) {
	count, err := Count(r.Context(), pool, listingID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statusResponse{Watching: watching, WatcherCount: count})
}

// HandleGetStatus tells the caller whether *they* are watching this listing,
// plus the real total — used on page load to set the heart's initial state.
func HandleGetStatus(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		listingID := r.PathValue("id")

		watching, err := IsWatching(r.Context(), pool, userID, listingID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		respondStatus(w, r, pool, userID, listingID, watching)
	}
}

func HandleAdd(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		listingID := r.PathValue("id")

		if err := Add(r.Context(), pool, userID, listingID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		respondStatus(w, r, pool, userID, listingID, true)
	}
}

func HandleRemove(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		listingID := r.PathValue("id")

		if err := Remove(r.Context(), pool, userID, listingID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		respondStatus(w, r, pool, userID, listingID, false)
	}
}

// HandleMyWatchlist returns every listing ID the caller is watching, so a
// page rendering a grid of ListingCards can initialize every heart's state
// in one request instead of one-per-card.
func HandleMyWatchlist(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ids, err := MyWatchedListingIDs(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ids)
	}
}
