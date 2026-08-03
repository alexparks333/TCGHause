package user

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// HandleMe replaces the inline handleMe that used to live in cmd/api/main.go
// — same route, same JSON shape, plus the new username field.
func HandleMe(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		u, err := Get(r.Context(), pool, userID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "profile not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u)
	}
}

type setUsernameInput struct {
	Username string `json:"username"`
}

// HandleSetUsername backs both the claim-username page and the "change
// username" control in Account Settings — no separate claim/edit endpoint,
// since SetUsername's semantics are identical either way.
func HandleSetUsername(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var in setUsernameInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		u, err := SetUsername(r.Context(), pool, userID, in.Username)
		if err != nil {
			switch {
			case errors.Is(err, ErrInvalidUsername):
				http.Error(w, err.Error(), http.StatusBadRequest)
			case errors.Is(err, ErrUsernameTaken):
				http.Error(w, err.Error(), http.StatusConflict)
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u)
	}
}

// HandleUsernameAvailable is the one deliberately public (no RequireAuth)
// handler in this package — SignUpForm needs to call it before an account
// exists at all. Always 200 with a boolean body; see IsUsernameAvailable's
// doc comment for why malformed input isn't a 400.
func HandleUsernameAvailable(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username := r.URL.Query().Get("username")
		available, err := IsUsernameAvailable(r.Context(), pool, username)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"available": available})
	}
}

// HandleGetByUsername backs a seller's public profile page — public, no
// RequireAuth, and deliberately encodes ToPublic() rather than the raw
// User so email can never leak through this route.
func HandleGetByUsername(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := GetByUsername(r.Context(), pool, r.PathValue("username"))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "user not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u.ToPublic())
	}
}

type setBioInput struct {
	Bio string `json:"bio"`
}

func HandleSetBio(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var in setBioInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		u, err := SetBio(r.Context(), pool, userID, in.Bio)
		if err != nil {
			if errors.Is(err, ErrInvalidBio) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(u)
	}
}
