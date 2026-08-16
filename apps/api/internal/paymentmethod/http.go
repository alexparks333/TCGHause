package paymentmethod

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

func HandleList(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		cards, err := List(r.Context(), pool, paymentClient, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cards)
	}
}

// HandleListBanks is HandleList's bank-account counterpart — "Linked Bank
// Accounts" in Account Settings and the saved-method picker on checkout's
// "Pay by bank instead" tab.
func HandleListBanks(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		banks, err := ListBanks(r.Context(), pool, paymentClient, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(banks)
	}
}

type setupIntentResponse struct {
	ClientSecret string `json:"clientSecret"`
}

func HandleCreateSetupIntent(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		clientSecret, err := CreateSetupIntentSecret(r.Context(), pool, paymentClient, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(setupIntentResponse{ClientSecret: clientSecret})
	}
}

// HandleCreateBankSetupIntent is HandleCreateSetupIntent's bank-account
// counterpart — backs "Link a bank account" in Account Settings and
// checkout's inline bank-linking flow.
func HandleCreateBankSetupIntent(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		clientSecret, err := CreateBankSetupIntentSecret(r.Context(), pool, paymentClient, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(setupIntentResponse{ClientSecret: clientSecret})
	}
}

// HandleSetDefault also backs "Make default" for a saved BANK account —
// SetDefault only ever operates on a payment-method id, ownership-checked
// against the caller's own Stripe customer, so it's type-agnostic and
// reused as-is for both /me/payment-methods/{id}/default and
// /me/payment-methods/banks/{id}/default (cmd/api/main.go).
func HandleSetDefault(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := SetDefault(r.Context(), pool, paymentClient, userID, r.PathValue("id")); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// HandleDelete also backs "Remove" for a saved BANK account — same
// type-agnostic reuse as HandleSetDefault above.
func HandleDelete(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := Delete(r.Context(), pool, paymentClient, userID, r.PathValue("id")); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
