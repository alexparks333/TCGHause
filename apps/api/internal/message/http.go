package message

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// myThreadsResponse pairs the inbox list with the unread conversation
// count in one response — same reasoning as notification's
// myNotificationsResponse: the caller needs both (the list, and the badge
// count shown in AccountMenu/AccountTabs) and there's no reason to make it
// round-trip twice.
type myThreadsResponse struct {
	Threads     []ThreadSummary `json:"threads"`
	UnreadCount int             `json:"unreadCount"`
}

func HandleMyThreads(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		threads, unread, err := ListThreadsForUser(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(myThreadsResponse{Threads: threads, UnreadCount: unread})
	}
}

type startThreadRequest struct {
	RecipientID string  `json:"recipientId"`
	ListingID   *string `json:"listingId,omitempty"`
	Body        string  `json:"body"`
}

// HandleStartThread is the "message this seller" flow — finds or creates
// the conversation with recipientId and sends body as its first (or next)
// message, atomically. Reused for "message again" from an existing
// thread's counterpart just as much as a brand-new conversation, since
// starting one that already exists is a no-op find, not an error.
func HandleStartThread(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req startThreadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.RecipientID == "" {
			http.Error(w, "recipientId is required", http.StatusBadRequest)
			return
		}
		detail, err := StartThreadWithMessage(r.Context(), pool, userID, req.RecipientID, req.ListingID, req.Body)
		if err != nil {
			writeMessageError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(detail)
	}
}

func HandleGetThread(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		detail, err := GetThreadDetail(r.Context(), pool, userID, r.PathValue("id"))
		if err != nil {
			writeMessageError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(detail)
	}
}

type sendMessageRequest struct {
	Body string `json:"body"`
}

func HandleSendMessage(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req sendMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		msg, err := SendMessage(r.Context(), pool, userID, r.PathValue("id"), req.Body)
		if err != nil {
			writeMessageError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(msg)
	}
}

// HandleDevSimulateIncoming backs the dev panel's "Get a Message" button —
// sends one real message from some other real user to the caller so the
// caller's own poll picks it up as a genuine incoming message. Double-gated
// on AllowDevSimulateIncoming: DevSimulateIncoming itself refuses to run
// outside development regardless of whether this route is somehow reached,
// same belt-and-suspenders shape as every other dev-only route in this
// codebase.
func HandleDevSimulateIncoming(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if err := DevSimulateIncoming(r.Context(), pool, userID); err != nil {
			switch {
			case errors.Is(err, ErrDevSimulateDisabled), errors.Is(err, ErrNoOtherUsers):
				http.Error(w, err.Error(), http.StatusBadRequest)
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeMessageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, ErrNotParticipant):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, ErrSelfMessage), errors.Is(err, ErrEmptyBody):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
