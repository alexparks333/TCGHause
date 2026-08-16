package payout

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
)

type payoutResponse struct {
	PayoutID string `json:"payoutId,omitempty"`
	// Triggered is false when the seller had nothing released to pay out
	// — not an error, just nothing to do right now.
	Triggered bool `json:"triggered"`
}

// HandleTriggerInstant backs the Withdraw page's "Instant Transfer" button
// (design doc v2 §6.3) — pays out everything currently released for the
// caller right now, at the 2% instant-payout price, landing in ~30
// minutes instead of Standard's ~1-2 business days.
func HandleTriggerInstant(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		payoutID, err := TriggerInstantPayout(r.Context(), pool, paymentClient, sellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(payoutResponse{PayoutID: payoutID, Triggered: payoutID != ""})
	}
}

// HandleTriggerStandard backs the Withdraw page's "Standard Transfer"
// button — free, ~1-2 business days, Stripe's ordinary payout speed. The
// ONLY way a released order's money ever reaches the seller's bank now
// that there's no automatic background sweep (see cmd/worker/main.go's
// doc comment) — every payout is a direct click on one of these two
// buttons, never something that happens on its own.
func HandleTriggerStandard(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		payoutID, err := TriggerStandardPayout(r.Context(), pool, paymentClient, sellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(payoutResponse{PayoutID: payoutID, Triggered: payoutID != ""})
	}
}

type summaryResponse struct {
	AvailableCents int64    `json:"availableCents"`
	PendingCents   int64    `json:"pendingCents"`
	Recent         []Record `json:"recent"`
}

// HandleSummary backs the Withdraw page — wallet balance (available now),
// the greyed-out "still on hold" figure next to it, and recent payout
// history, all in one round trip.
func HandleSummary(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sellerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		summary, err := GetSummary(r.Context(), pool, sellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		recent, err := ListRecent(r.Context(), pool, sellerID, 20)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(summaryResponse{
			AvailableCents: summary.AvailableCents,
			PendingCents:   summary.PendingCents,
			Recent:         recent,
		})
	}
}
