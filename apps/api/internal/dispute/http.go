package dispute

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, order.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrNotBuyer), errors.Is(err, ErrNotParticipant):
		return http.StatusForbidden
	case errors.Is(err, ErrOrderNotClaimable), errors.Is(err, ErrNotNegotiating),
		errors.Is(err, ErrNotUnderReview), errors.Is(err, ErrAlreadyAppealed),
		errors.Is(err, ErrInvalidTransition):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

type openClaimRequest struct {
	OrderID    string     `json:"orderId"`
	ReasonCode ReasonCode `json:"reasonCode"`
	Body       string     `json:"body"`
}

// HandleOpen backs "File a claim" on the order-status page.
func HandleOpen(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req openClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OrderID == "" || req.ReasonCode == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		claimID, err := OpenClaim(r.Context(), pool, req.OrderID, buyerID, req.ReasonCode, req.Body)
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		c, err := Get(r.Context(), pool, claimID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	}
}

type claimDetail struct {
	Claim  *Claim  `json:"claim"`
	Events []Event `json:"events"`
}

// HandleGet backs the claims thread UI — visible to either the order's
// buyer or seller.
func HandleGet(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		c, err := Get(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		if err := requireParticipant(r.Context(), pool, c.OrderID, callerID); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		events, err := Events(r.Context(), pool, c.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claimDetail{Claim: c, Events: events})
	}
}

type messageRequest struct {
	Body string `json:"body"`
}

func HandleAddMessage(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req messageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Body == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := AddMessage(r.Context(), pool, r.PathValue("id"), callerID, req.Body); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type evidenceRequest struct {
	URL string `json:"url"`
}

func HandleAddEvidence(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req evidenceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := AddEvidence(r.Context(), pool, r.PathValue("id"), callerID, req.URL); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleResolveByAgreement(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := ResolveByAgreement(r.Context(), pool, r.PathValue("id"), callerID); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type partialRefundRequest struct {
	AmountCents int64 `json:"amountCents"`
}

func HandleProposePartialRefund(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req partialRefundRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AmountCents <= 0 {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := ProposePartialRefund(r.Context(), pool, r.PathValue("id"), callerID, req.AmountCents); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleAcceptPartialRefund(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := AcceptPartialRefund(r.Context(), pool, paymentClient, r.PathValue("id"), callerID); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleEscalate(pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		c, err := Get(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		if err := requireParticipant(r.Context(), pool, c.OrderID, callerID); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		if err := Escalate(r.Context(), pool, paymentClient, mailClient, webOrigin, c.ID); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleAppeal(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req messageRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if err := Appeal(r.Context(), pool, r.PathValue("id"), callerID, req.Body); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// HandleGetForListing backs the order-status page's "is there already a
// claim on this order" check — mounted under /listings/{id}/order/claim,
// matching internal/order's own listing-scoped route convention, so the
// frontend never needs to know an order's own id just to ask this.
// 404 (via ErrNotFound) means no claim exists yet — that's the common
// case, not a bug.
func HandleGetForListing(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		if callerID != o.BuyerID && callerID != o.SellerID {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		c, err := GetForOrder(r.Context(), pool, o.ID)
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		events, err := Events(r.Context(), pool, c.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claimDetail{Claim: c, Events: events})
	}
}

// --- Minimal admin review surface ---
//
// No admin app exists anywhere in this repo (flagged explicitly in the
// implementation plan, not a gap discovered late) — this is a bare
// authenticated internal route gated by an email allowlist
// (platform.Config.AdminEmails), not a real admin panel. Good enough to
// exercise and test the human-review path; a genuine admin surface (case
// queue, evidence viewer, reviewer assignment enforcing "a different
// reviewer" for appeals) is real future work.

type decideRequest struct {
	Resolution  Resolution  `json:"resolution"`
	LiableParty LiableParty `json:"liableParty"`
	RefundCents int64       `json:"refundCents"`
}

func HandleDecide(pool *pgxpool.Pool, paymentClient *payment.Client, adminEmails string) http.HandlerFunc {
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
		var req decideRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Resolution == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := Decide(r.Context(), pool, paymentClient, r.PathValue("id"), callerID, req.Resolution, req.LiableParty, req.RefundCents); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func HandleDecideAppeal(pool *pgxpool.Pool, paymentClient *payment.Client, adminEmails string) http.HandlerFunc {
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
		var req decideRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Resolution == "" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if err := DecideAppeal(r.Context(), pool, paymentClient, r.PathValue("id"), callerID, req.Resolution, req.LiableParty, req.RefundCents); err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Admin claims queue ---
//
// Turns the decide/decide-appeal calls above into something a hired
// reviewer can actually work from a browser, instead of a raw authenticated
// API call — the first piece of what CLAUDE.md's "Workers side" is meant to
// grow into. Same minimal-admin-surface caveat as everything else in this
// file: gated by the ADMIN_EMAILS allowlist, not a real user/role system.

type adminClaimDetail struct {
	Claim  *AdminClaimSummary `json:"claim"`
	Events []Event            `json:"events"`
}

// HandleAdminList backs the claims queue page — ?state= narrows to one
// state (e.g. human_review, the "needs a decision" queue); omitted returns
// everything, newest first, for a full history view.
func HandleAdminList(pool *pgxpool.Pool, adminEmails string) http.HandlerFunc {
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
		claims, err := ListForAdmin(r.Context(), pool, r.URL.Query().Get("state"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claims)
	}
}

// HandleAdminGet backs the claim detail/decide screen — full negotiation
// thread plus the order/listing context GetForAdmin denormalizes, so a
// reviewer never has to separately look up the order to know what they're
// deciding on.
func HandleAdminGet(pool *pgxpool.Pool, adminEmails string) http.HandlerFunc {
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
		c, err := GetForAdmin(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), statusFor(err))
			return
		}
		events, err := Events(r.Context(), pool, c.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(adminClaimDetail{Claim: c, Events: events})
	}
}
