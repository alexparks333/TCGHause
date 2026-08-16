package seller

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

// HandleGetConnectAccount backs "Set up payouts" in seller settings —
// reports current onboarding state without creating anything, so a seller
// who's never started onboarding just sees hasAccount: false.
func HandleGetConnectAccount(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		status, err := GetConnectAccountStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}
}

// HandleCreateConnectAccount idempotently ensures userID has a Connect
// Express account — safe to call repeatedly; returns the existing account's
// status if one was already created.
func HandleCreateConnectAccount(pool *pgxpool.Pool, paymentClient *payment.Client, webOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if _, err := EnsureConnectAccount(r.Context(), pool, paymentClient, userID, webOrigin); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		status, err := GetConnectAccountStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}
}

type onboardingLinkResponse struct {
	URL string `json:"url"`
}

// allowedReturnPaths is every page that embeds SellerPayoutsSetup and can
// therefore ask to be the return destination — an allowlist rather than
// trusting an arbitrary client-supplied path verbatim, since this becomes
// part of a URL Stripe redirects the seller through.
var allowedReturnPaths = map[string]bool{
	"/account/settings": true,
	"/sell":             true,
	"/account/withdraw": true,
}

// HandleCreateOnboardingLink returns a fresh Stripe-hosted onboarding URL —
// the frontend redirects the seller there. webOrigin builds the return/
// refresh URLs the seller comes back to (account.updated is still the only
// trusted signal that onboarding actually finished, see
// SyncConnectAccountFromWebhook). ?returnPath= lets the caller land back
// wherever they started (e.g. /sell, so a seller prompted to onboard mid-
// listing-creation returns straight to the wizard instead of Settings) —
// defaults to /account/settings if unset or not on the allowlist.
func HandleCreateOnboardingLink(pool *pgxpool.Pool, paymentClient *payment.Client, webOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		returnPath := r.URL.Query().Get("returnPath")
		if !allowedReturnPaths[returnPath] {
			returnPath = "/account/settings"
		}
		returnURL := webOrigin + returnPath + "?connect=return"
		refreshURL := webOrigin + returnPath + "?connect=refresh"
		url, err := CreateOnboardingLink(r.Context(), pool, paymentClient, userID, webOrigin, returnURL, refreshURL)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(onboardingLinkResponse{URL: url})
	}
}
