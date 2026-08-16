package platform

import "net/http"

// WithCORS allows browser JS on any of allowedOrigins (apps/web) to call
// this API directly, including the Authorization header the JWT verifier
// reads. Takes a list, not one fixed string, because local dev genuinely
// needs more than one valid origin at once: apps/web is reachable at both
// plain localhost (normal desktop testing) and the dev machine's LAN IP
// (required for testing from a phone, e.g. the Sell wizard's phone-upload
// QR feature) — a single hardcoded origin meant switching between the two
// silently broke every authenticated POST (CORS rejects a mismatched
// Origin with no useful error, just "Failed to fetch" in the browser).
// CORS requires echoing back the SPECIFIC matching origin, not a
// comma-joined list — the header only ever accepts one value.
func WithCORS(allowedOrigins []string, next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
