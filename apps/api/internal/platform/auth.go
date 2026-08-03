package platform

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userIDContextKey contextKey = "userID"

// AuthVerifier verifies Supabase-issued access tokens (JWTs) against the
// project's published JWKS. The Go API never sees a password or issues a
// session itself — Supabase Auth does that; this only checks the token
// on the way in. See CLAUDE.md's auth section for the full flow.
type AuthVerifier struct {
	jwks keyfunc.Keyfunc
}

// NewAuthVerifier fetches and caches the JWKS at jwksURL, refreshing it
// automatically in the background for the lifetime of ctx.
func NewAuthVerifier(ctx context.Context, jwksURL string) (*AuthVerifier, error) {
	k, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, fmt.Errorf("fetch jwks from %s: %w", jwksURL, err)
	}
	return &AuthVerifier{jwks: k}, nil
}

// RequireAuth verifies the "Authorization: Bearer <token>" header and, on
// success, injects the token's subject (the Supabase user id) into the
// request context for downstream handlers to read via UserIDFromContext.
func (a *AuthVerifier) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		tokenString := strings.TrimPrefix(header, "Bearer ")
		if tokenString == "" || tokenString == header {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}

		token, err := jwt.Parse(tokenString, a.jwks.Keyfunc, jwt.WithValidMethods([]string{"ES256", "RS256"}))
		if err != nil || !token.Valid {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, "invalid token claims", http.StatusUnauthorized)
			return
		}
		userID, _ := claims["sub"].(string)
		if userID == "" {
			http.Error(w, "token missing subject", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), userIDContextKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserIDFromContext returns the authenticated user's id, if RequireAuth
// has run for this request.
func UserIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(userIDContextKey).(string)
	return id, ok
}
