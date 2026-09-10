package notification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("notification not found")

// execer is satisfied by both *pgxpool.Pool and pgx.Tx — Create is called
// from inside auction's own bid-placement and auction-close transactions
// (so a notification can never exist without the event that caused it
// actually having committed, or vice versa), not as a standalone write.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Kind string

const (
	KindWon    Kind = "won"    // you were the high bidder when an auction you bid on closed
	KindBought Kind = "bought" // you bought a listing outright via Buy It Now, no bidding involved
	KindSold   Kind = "sold"   // your listing closed with a winning bidder, however it sold
	KindOutbid Kind = "outbid" // someone else's bid just took the lead away from you

	// A buyer left a review of you as the seller (feedback.Upsert) / you
	// left a review of a buyer and they're now seeing it (buyerreview.Upsert).
	// Dedupes against each other (a resubmitted review collapses into one
	// row) but never against a won/sold/outbid/bought notification for
	// that same listing — see migration 0047's two partial unique indexes,
	// and isReviewKind below, which is what routes Create to the right one.
	KindSellerReviewReceived Kind = "seller_review"
	KindBuyerReviewReceived  Kind = "buyer_review"

	// A buyer submitted a real offer (internal/offer) on one of your
	// listings / the seller responded to an offer you sent. Unlike the
	// four kinds above, these never collapse into one row per listing —
	// see CreateForOffer's doc comment and migration 0051.
	KindOfferReceived Kind = "offer_received"
	KindOfferAccepted Kind = "offer_accepted"
	KindOfferDeclined Kind = "offer_declined"
)

// isReviewKind reports whether kind belongs to the review partial unique
// index (notifications_user_id_listing_id_review_key) rather than the
// original four-kind auction-outcome one
// (notifications_user_id_listing_id_outcome_key) — see Create.
func isReviewKind(kind Kind) bool {
	return kind == KindSellerReviewReceived || kind == KindBuyerReviewReceived
}

// Notification is one row, with the listing's current title and first
// photo joined in — same "don't duplicate what's already on the listing
// row" reasoning as CelebrationItem/MyBid/Review. ListingImageURL is empty
// when the listing has no photos (e.g. a dev quick-list test listing);
// the frontend falls back to a plain placeholder the same way
// ListingImage/CardArt do everywhere else.
type Notification struct {
	ID           string `json:"id"`
	Kind         Kind   `json:"kind"`
	ListingID    string `json:"listingId"`
	ListingTitle string `json:"listingTitle"`
	// ListingGame backs the frontend's gradient placeholder (ListingImage/
	// CardArt) for a listing with no real uploaded photo — a dev quick-list
	// listing, most often — so this dropdown's thumbnail matches what the
	// listing itself actually shows instead of going blank.
	ListingGame     string `json:"listingGame"`
	ListingImageURL string `json:"listingImageUrl,omitempty"`
	// OfferID is set on the three offer_* kinds only (see CreateForOffer) —
	// lets the frontend route straight to the specific offer instead of
	// just the listing, which matters here in a way it doesn't for
	// won/sold/bought: a listing can have several different pending
	// offers at once, so "the listing" alone doesn't disambiguate which
	// one this notification is about.
	OfferID   *string `json:"offerId,omitempty"`
	ReadAt    *string `json:"readAt"`
	CreatedAt string  `json:"createdAt"`
}

// Create records one notification, or updates the existing one if this
// user already has an un-dismissed notification of the same "family" for
// this listing (one of migration 0047's two partial unique indexes) — a
// bidding war (outbid, rebid, outbid again..., won) re-surfaces the same
// row with its kind/timestamp refreshed instead of piling up a duplicate
// per event, and separately, a resubmitted review does the same within
// its own row — but the two families never collapse into each other (a
// 'sold' notification and a later 'seller_review' notification for the
// same listing both stay visible). Bumping read_at back to null on every
// update is deliberate: a repeat event is new information even if the
// previous one was already read. Called with a pgx.Tx from within the
// transaction that caused it (auction close, bid placement, review
// upsert) so the two can never drift apart — see the package doc comment.
func Create(ctx context.Context, db execer, userID string, kind Kind, listingID string) error {
	// The ON CONFLICT predicate has to be a literal that matches one of
	// the two partial unique indexes exactly for Postgres to infer it —
	// it can't reference the row being inserted, hence the branch here
	// rather than a single dynamic query.
	conflictSQL := `
		insert into notifications (user_id, kind, listing_id)
		values ($1, $2, $3)
		on conflict (user_id, listing_id) where kind in ('won', 'sold', 'outbid', 'bought')
		do update set kind = excluded.kind, read_at = null, created_at = now()
	`
	if isReviewKind(kind) {
		conflictSQL = `
			insert into notifications (user_id, kind, listing_id)
			values ($1, $2, $3)
			on conflict (user_id, listing_id) where kind in ('seller_review', 'buyer_review')
			do update set kind = excluded.kind, read_at = null, created_at = now()
		`
	}
	if _, err := db.Exec(ctx, conflictSQL, userID, kind, listingID); err != nil {
		return fmt.Errorf("upsert notification: %w", err)
	}
	return nil
}

// CreateForOffer records one notification for an offer_* kind — a plain
// insert with no ON CONFLICT target at all, deliberately unlike Create
// above. A listing can have several different buyers each with their own
// live pending offer at once, so collapsing by (user_id, listing_id) the
// way the auction-outcome/review families do would let a second buyer's
// offer silently overwrite the first's still-unread notification about
// theirs. offerID disambiguates which specific offer this row is about —
// see migration 0051 and Notification.OfferID's doc comment.
func CreateForOffer(ctx context.Context, db execer, userID string, kind Kind, listingID, offerID string) error {
	if _, err := db.Exec(ctx, `
		insert into notifications (user_id, kind, listing_id, offer_id)
		values ($1, $2, $3, $4)
	`, userID, kind, listingID, offerID); err != nil {
		return fmt.Errorf("insert offer notification: %w", err)
	}
	return nil
}

// ListForUser returns the caller's most recent notifications (newest
// first) plus their unread count — the unread count is queried separately
// rather than derived from the capped list, since "47 unread" should still
// read correctly even once the list itself is capped to the most recent
// limit rows.
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID string, limit int) ([]Notification, int, error) {
	rows, err := pool.Query(ctx, `
		select n.id, n.kind, n.listing_id, l.title, l.game, l.image_urls, n.offer_id, n.read_at, n.created_at
		from notifications n
		join listings l on l.id = n.listing_id
		where n.user_id = $1
		order by n.created_at desc
		limit $2
	`, userID, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()

	out := []Notification{}
	for rows.Next() {
		var n Notification
		var imageURLs []string
		var readAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.ListingID, &n.ListingTitle, &n.ListingGame, &imageURLs, &n.OfferID, &readAt, &createdAt); err != nil {
			return nil, 0, fmt.Errorf("scan notification: %w", err)
		}
		if len(imageURLs) > 0 {
			n.ListingImageURL = imageURLs[0]
		}
		n.CreatedAt = createdAt.Format(time.RFC3339)
		if readAt != nil {
			s := readAt.Format(time.RFC3339)
			n.ReadAt = &s
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	var unread int
	if err := pool.QueryRow(ctx, `
		select count(*) from notifications where user_id = $1 and read_at is null
	`, userID).Scan(&unread); err != nil {
		return nil, 0, fmt.Errorf("count unread: %w", err)
	}

	return out, unread, nil
}

// MarkRead marks one of the caller's own notifications read — scoped to
// user_id so one account can never mark (or even discover the existence
// of) another account's notification.
func MarkRead(ctx context.Context, pool *pgxpool.Pool, userID, notificationID string) error {
	tag, err := pool.Exec(ctx, `
		update notifications set read_at = now()
		where id = $1 and user_id = $2 and read_at is null
	`, notificationID, userID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either it doesn't exist, belongs to someone else, or was already
		// read — all three are a no-op from the caller's point of view, not
		// worth distinguishing (same reasoning as AckCelebration).
		var exists bool
		if err := pool.QueryRow(ctx, `select exists (select 1 from notifications where id = $1)`, notificationID).Scan(&exists); err != nil {
			return fmt.Errorf("check exists: %w", err)
		}
		if !exists {
			return ErrNotFound
		}
	}
	return nil
}

// MarkAllRead marks every one of the caller's unread notifications read in
// one statement — backs the bell's "mark all read" action.
func MarkAllRead(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	_, err := pool.Exec(ctx, `
		update notifications set read_at = now() where user_id = $1 and read_at is null
	`, userID)
	if err != nil {
		return fmt.Errorf("mark all read: %w", err)
	}
	return nil
}
