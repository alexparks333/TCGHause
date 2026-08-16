package metrics

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

// HandleGet backs the internal metrics dashboard — admin-only, same email
// allowlist as internal/dispute's human-review routes.
func HandleGet(pool *pgxpool.Pool, adminEmails string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !user.IsAdmin(r.Context(), pool, adminEmails, callerID) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		snapshot, err := Compute(r.Context(), pool)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(snapshot)
	}
}
