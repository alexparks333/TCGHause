// Package photosession lets a seller filling out the Sell wizard on desktop
// scan a QR code and take photos with their phone's camera, landing straight
// in the wizard's photo grid — see CLAUDE.md's Sell-wizard section and
// apps/web/components/sell-wizard/PhoneUploadPanel.tsx. The phone is
// deliberately never logged in: the session id itself is the sole bearer
// credential for the phone-side endpoints (see http.go's HandleUploadPhoto
// doc comment for why this is weaker than a real webhook signature, and why
// that's an acceptable tradeoff here).
package photosession

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("photo upload session not found")
var ErrExpired = errors.New("photo upload session expired")
var ErrPhotoLimitReached = errors.New("photo upload session already has the maximum number of photos")

// sessionTTL mirrors the Sell wizard's realistic in-person usage window —
// long enough to take several photos without rushing, short enough that a
// leaked/observed session id (the only thing gating the upload endpoint)
// stops being useful quickly.
const sessionTTL = 20 * time.Minute

// maxPhotos matches SortablePhotoGrid.tsx's MAX_PHOTOS. Enforced here too,
// not just client-side, because the upload endpoint this guards is
// intentionally unauthenticated for the session's lifetime — without a
// server-side cap it would be an unbounded storage-write vector, not just
// "a few extra photos."
const maxPhotos = 10

type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	PhotoURLs []string  `json:"photoUrls"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func IsExpired(s Session) bool {
	return time.Now().After(s.ExpiresAt)
}

func Create(ctx context.Context, pool *pgxpool.Pool, userID string) (Session, error) {
	var s Session
	err := pool.QueryRow(ctx, `
		insert into photo_upload_sessions (user_id, expires_at)
		values ($1, now() + interval '20 minutes')
		returning id, user_id, photo_urls, created_at, expires_at
	`, userID).Scan(&s.ID, &s.UserID, &s.PhotoURLs, &s.CreatedAt, &s.ExpiresAt)
	if err != nil {
		return Session{}, fmt.Errorf("create photo upload session: %w", err)
	}
	return s, nil
}

func Get(ctx context.Context, pool *pgxpool.Pool, id string) (Session, error) {
	var s Session
	err := pool.QueryRow(ctx, `
		select id, user_id, photo_urls, created_at, expires_at
		from photo_upload_sessions where id = $1
	`, id).Scan(&s.ID, &s.UserID, &s.PhotoURLs, &s.CreatedAt, &s.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrNotFound
		}
		return Session{}, fmt.Errorf("get photo upload session: %w", err)
	}
	return s, nil
}

// AddPhoto appends url to the session's photo list in one atomic UPDATE —
// race-free (Postgres serializes concurrent updates to the same row) without
// a separate read-modify-write round trip. Rejects once the session already
// has maxPhotos, and rejects an expired session even though HandleUploadPhoto
// also checks this before calling in — defense in depth for the one code
// path in this codebase with no auth at all.
func AddPhoto(ctx context.Context, pool *pgxpool.Pool, sessionID, url string) error {
	tag, err := pool.Exec(ctx, `
		update photo_upload_sessions
		set photo_urls = array_append(photo_urls, $2)
		where id = $1
		  and expires_at > now()
		  and coalesce(array_length(photo_urls, 1), 0) < $3
	`, sessionID, url, maxPhotos)
	if err != nil {
		return fmt.Errorf("add photo to session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Distinguish "doesn't exist" from "exists but expired/full" for a
		// clearer error back to the phone.
		s, getErr := Get(ctx, pool, sessionID)
		if getErr != nil {
			return getErr
		}
		if IsExpired(s) {
			return ErrExpired
		}
		return ErrPhotoLimitReached
	}
	return nil
}

func ListPhotos(ctx context.Context, pool *pgxpool.Pool, sessionID string) ([]string, error) {
	s, err := Get(ctx, pool, sessionID)
	if err != nil {
		return nil, err
	}
	return s.PhotoURLs, nil
}
