package photosession

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/platform"
)

// maxUploadBytes is the 10MB bucket limit (matches apps/web/lib/storage.ts's
// MAX_BYTES) plus a little slack for multipart overhead.
const maxUploadBytes = 10<<20 + 1024

var allowedContentTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

type createResponse struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// HandleCreate starts a new session for the caller — the desktop side of the
// QR handoff. Authenticated: only the seller actually running the Sell
// wizard can mint a session tied to their own storage folder.
func HandleCreate(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := Create(r.Context(), pool, userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createResponse{ID: s.ID, ExpiresAt: s.ExpiresAt})
	}
}

type statusResponse struct {
	Expired    bool `json:"expired"`
	PhotoCount int  `json:"photoCount"`
}

// HandleGetStatus lets the phone page confirm a scanned session is still
// good before it shows the camera UI. Deliberately unauthenticated (the
// phone is never logged in) and deliberately returns nothing but a bool and
// a count — no user id, no photo URLs — so a session id alone doesn't leak
// anything beyond "is this still open."
func HandleGetStatus(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := Get(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(statusResponse{Expired: IsExpired(s), PhotoCount: len(s.PhotoURLs)})
	}
}

type listPhotosResponse struct {
	PhotoURLs []string `json:"photoUrls"`
}

// HandleListPhotos is the desktop's poll target while a session's QR panel
// is open. Authenticated, and additionally checks the caller actually owns
// this session — the listing-photos bucket is already public, so this isn't
// gating confidentiality of the photos themselves, just who gets to
// passively observe a session's progress.
func HandleListPhotos(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s, err := Get(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if s.UserID != userID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(listPhotosResponse{PhotoURLs: s.PhotoURLs})
	}
}

type uploadPhotoResponse struct {
	URL string `json:"url"`
}

// HandleUploadPhoto is the one deliberately unauthenticated write endpoint
// in this codebase. It structurally resembles internal/shipping/webhook.go
// (no Supabase JWT, verified inline instead) but is NOT the same strength
// of guarantee: the webhook checks an HMAC signature from a trusted sender,
// this only checks "does this session id exist and hasn't expired" — the
// session id itself is the entire credential. That's an accepted tradeoff
// (see internal/photosession's package doc and CLAUDE.md), not an oversight
// — don't treat this as a precedent for skipping real verification
// elsewhere.
func HandleUploadPhoto(pool *pgxpool.Pool, supabaseURL, serviceRoleKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.PathValue("id")

		s, err := Get(r.Context(), pool, sessionID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if IsExpired(s) {
			http.Error(w, "session expired", http.StatusGone)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
		if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
			http.Error(w, "photo too large or malformed upload", http.StatusRequestEntityTooLarge)
			return
		}
		file, header, err := r.FormFile("photo")
		if err != nil {
			http.Error(w, "missing photo field", http.StatusBadRequest)
			return
		}
		defer file.Close()

		contentType := header.Header.Get("Content-Type")
		if !allowedContentTypes[contentType] {
			http.Error(w, "photos must be JPEG, PNG, or WebP", http.StatusUnsupportedMediaType)
			return
		}
		ext, _ := extensionForContentType(contentType)

		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, "read upload", http.StatusBadRequest)
			return
		}

		// Same {user_id}/... prefix the desktop upload path uses (see
		// storage.go's doc comment on bucket) — a nanosecond timestamp is
		// unique enough within one session's sequential phone uploads,
		// no random-id package exists in this codebase to reach for instead.
		path := fmt.Sprintf("%s/%s-%d.%s", s.UserID, s.ID, time.Now().UnixNano(), ext)

		url, err := uploadToSupabaseStorage(r.Context(), supabaseURL, serviceRoleKey, path, data, contentType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if err := AddPhoto(r.Context(), pool, sessionID, url); err != nil {
			if errors.Is(err, ErrExpired) {
				http.Error(w, "session expired", http.StatusGone)
				return
			}
			if errors.Is(err, ErrPhotoLimitReached) {
				http.Error(w, "photo limit reached", http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(uploadPhotoResponse{URL: url})
	}
}
