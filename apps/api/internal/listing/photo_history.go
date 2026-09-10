package listing

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PhotoEdit is one row of a listing's photo-edit audit trail — recorded by
// Update whenever imageUrls actually changes (an add, a delete, or a pure
// reorder) while the listing is still in its editable pre-bid window (see
// UpdateInput's own doc comment). Exists specifically so a dispute reviewer
// can check a "the seller swapped the photos right before it sold" claim
// against a real record, not either side's word — surfaced to admins only,
// via the claim detail page (CLAUDE.md §6.17).
type PhotoEdit struct {
	ID              string    `json:"id"`
	ListingID       string    `json:"listingId"`
	SellerID        string    `json:"sellerId"`
	BeforeImageUrls []string  `json:"beforeImageUrls"`
	AfterImageUrls  []string  `json:"afterImageUrls"`
	CreatedAt       time.Time `json:"createdAt"`
}

// recordPhotoEdit inserts one audit row inside Update's own transaction —
// never called standalone, and only ever when before/after actually differ
// (Update checks that itself before calling this), so every row here
// represents a real edit, never a no-op save.
func recordPhotoEdit(ctx context.Context, tx pgx.Tx, listingID, sellerID string, before, after []string) error {
	if _, err := tx.Exec(ctx, `
		insert into listing_photo_edits (listing_id, seller_id, before_image_urls, after_image_urls)
		values ($1, $2, $3, $4)
	`, listingID, sellerID, before, after); err != nil {
		return fmt.Errorf("record photo edit: %w", err)
	}
	return nil
}

// PhotoHistory returns every recorded photo edit for a listing, most recent
// first — the admin-only claim-review timeline (HandlePhotoHistory). Empty,
// not an error, for a listing whose photos were never edited after it was
// created.
func PhotoHistory(ctx context.Context, pool *pgxpool.Pool, listingID string) ([]PhotoEdit, error) {
	rows, err := pool.Query(ctx, `
		select id, listing_id, seller_id, before_image_urls, after_image_urls, created_at
		from listing_photo_edits
		where listing_id = $1
		order by created_at desc
	`, listingID)
	if err != nil {
		return nil, fmt.Errorf("query photo history: %w", err)
	}
	defer rows.Close()

	out := []PhotoEdit{}
	for rows.Next() {
		var e PhotoEdit
		if err := rows.Scan(&e.ID, &e.ListingID, &e.SellerID, &e.BeforeImageUrls, &e.AfterImageUrls, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan photo edit: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// stringSlicesEqual is order-sensitive on purpose — Update uses this to
// decide whether a save actually changed anything about the photos, and a
// pure reorder (same URLs, different order) is exactly as real an edit as
// an add or delete for the audit trail's purposes.
func stringSlicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
