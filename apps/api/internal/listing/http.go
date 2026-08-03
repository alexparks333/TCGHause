package listing

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// HandleCreate requires auth — the listing's seller is the caller's JWT
// subject, never a client-supplied field.
func HandleCreate(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var in CreateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		lst, err := Create(r.Context(), pool, sellerID, in)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrInvalidGame), errors.Is(err, ErrInvalidFormat), errors.Is(err, ErrInvalidInput), errors.Is(err, ErrInvalidDuration):
				status = http.StatusBadRequest
			case errors.Is(err, ErrSellerHasNoUsername):
				status = http.StatusForbidden
			}
			http.Error(w, err.Error(), status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(lst)
	}
}

func HandleGet(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lst, err := Get(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "listing not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lst)
	}
}

// queryInt64 parses an optional integer query param, returning nil (not a
// zero value) when absent or unparseable — malformed/missing filter values
// should be silently ignored, not 500 the whole listings page.
func queryInt64(q url.Values, key string) *int64 {
	raw := q.Get(key)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func queryFloat64(q url.Values, key string) *float64 {
	raw := q.Get(key)
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &v
}

// HandleList serves GET /listings with every filter from ListFilters as a
// query param (§6.14, §6.15): seller_id, game, q, finished, fixedOnly,
// priceMin/priceMax (cents), conditionMin, timeLeftMin/timeLeftMax (hours)
// — the real data behind the account "Selling" page, the homepage category
// filter + search box, and the Filters sidebar.
func HandleList(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		lists, err := ListActive(r.Context(), pool, ListFilters{
			SellerID:         q.Get("seller_id"),
			Game:             q.Get("game"),
			Search:           q.Get("q"),
			Finished:         q.Get("finished") == "true",
			FixedOnly:        q.Get("fixedOnly") == "true",
			PriceMinCents:    queryInt64(q, "priceMin"),
			PriceMaxCents:    queryInt64(q, "priceMax"),
			ConditionMin:     q.Get("conditionMin"),
			TimeLeftMinHours: queryFloat64(q, "timeLeftMin"),
			TimeLeftMaxHours: queryFloat64(q, "timeLeftMax"),
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lists)
	}
}

// HandleCounts serves GET /listings/counts — real per-game active-listing
// counts for the category bubbles (CLAUDE.md §6.14), never fabricated.
func HandleCounts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		counts, err := CountsByGame(r.Context(), pool)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(counts)
	}
}
