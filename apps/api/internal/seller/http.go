package seller

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
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

// HandleGetMyTier backs the seller's own account/settings tier display.
func HandleGetMyTier(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		status, err := GetMyTierStatus(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}
}

// statusForApplicationErr maps this package's Haus Trust application
// errors to HTTP statuses — same shape as internal/dispute/http.go's own
// statusFor, kept local since these errors are seller-package-specific.
func statusForApplicationErr(err error) int {
	switch {
	case errors.Is(err, ErrNotEligibleForHausTrust), errors.Is(err, ErrApplicationPending),
		errors.Is(err, ErrApplicationNotPending), errors.Is(err, ErrInvalidGrantedPct):
		return http.StatusUnprocessableEntity
	case errors.Is(err, ErrApplicationNotFound):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

type applyResponse struct {
	ApplicationID string `json:"applicationId"`
}

// HandleApplyForHausTrust backs a Platinum seller's "Apply for Haus Trust"
// action.
func HandleApplyForHausTrust(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, err := ApplyForHausTrust(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), statusForApplicationErr(err))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(applyResponse{ApplicationID: id})
	}
}

// --- Admin: Haus Trust applications ---
//
// Same minimal-admin-surface caveat as internal/dispute/http.go's own
// admin routes: gated by the ADMIN_EMAILS allowlist, not a real
// user/role system.

// HandleAdminListHausTrustApplications backs the admin queue — ?status=
// narrows to one state ("pending" is the actual "needs a decision" queue);
// omitted returns everything, newest first.
func HandleAdminListHausTrustApplications(pool *pgxpool.Pool, adminEmails string) http.HandlerFunc {
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
		apps, err := ListHausTrustApplications(r.Context(), pool, r.URL.Query().Get("status"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(apps)
	}
}

type decideApplicationRequest struct {
	Approve    bool    `json:"approve"`
	GrantedPct float64 `json:"grantedPct"`
	Note       string  `json:"note"`
}

// HandleAdminDecideHausTrustApplication approves (setting the seller's
// negotiated rate) or rejects one pending application.
func HandleAdminDecideHausTrustApplication(pool *pgxpool.Pool, adminEmails string) http.HandlerFunc {
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
		var req decideApplicationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := DecideHausTrustApplication(r.Context(), pool, r.PathValue("id"), callerID, req.Approve, req.GrantedPct, req.Note); err != nil {
			http.Error(w, err.Error(), statusForApplicationErr(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Dev-only: tier up/down ---

type devTierAdjustRequest struct {
	Direction string `json:"direction"`
}

type devTierAdjustResponse struct {
	Tier Tier `json:"tier"`
}

// HandleDevAdjustTier backs the dev panel's tier up/down arrows — nudges
// the CALLING user's own tier one step, bypassing every promotion gate.
// Double-gated on AllowDevTierAdjust: DevAdjustTier itself refuses to run
// outside development regardless of whether this route is somehow reached,
// same belt-and-suspenders shape as app/api/dev/switch-user's route
// handler re-checking NODE_ENV even though the panel that calls it is
// already dead-code-eliminated from production builds.
func HandleDevAdjustTier(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req devTierAdjustRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		newTier, err := DevAdjustTier(r.Context(), pool, userID, req.Direction)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, ErrDevTierAdjustDisabled):
				status = http.StatusNotFound // reads as "route doesn't exist," same as switch-user's own disabled response
			case errors.Is(err, ErrAlreadyAtTop), errors.Is(err, ErrAlreadyAtBottom):
				status = http.StatusUnprocessableEntity
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(devTierAdjustResponse{Tier: newTier})
	}
}
