package buyerreview

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/notification"
)

var (
	ErrCannotReviewSelf = errors.New("you cannot review yourself")
	ErrNotYourSale      = errors.New("you can only review a buyer on an order you sold to them")
	ErrOrderNotComplete = errors.New("you can only review a buyer once the order is complete")
	ErrInvalidRating    = errors.New("rating must be between 1 and 5, in quarter-star increments")
	ErrInvalidTag       = errors.New("tag must be one of trustworthy, suspicious, or aggressive")
	ErrCommentTooLong   = errors.New("comment must be 1000 characters or fewer")
	ErrReviewNotFound   = errors.New("review not found")
)

const maxCommentLength = 1000

var validTags = map[string]bool{"trustworthy": true, "suspicious": true, "aggressive": true}

// Review is one seller's rating+tag+comment for a buyer, tied to the one
// order it's about. Unlike seller_reviews (per-listing, since a seller can
// be reviewed by many different buyers across many listings and needs a
// union query to prove any given purchase happened), a buyer review is
// naturally per-order: an order already pins exactly one buyer_id and one
// seller_id, so the order itself is the proof of purchase — see saleState.
type Review struct {
	ID           string  `json:"id"`
	OrderID      string  `json:"orderId"`
	BuyerID      string  `json:"buyerId"`
	ReviewerID   string  `json:"reviewerId"`
	ListingTitle string  `json:"listingTitle"`
	Rating       float64 `json:"rating"`
	Tag          string  `json:"tag"`
	Comment      *string `json:"comment"`
	CreatedAt    string  `json:"createdAt"`
}

// Stats is the buyer-reputation summary shown on the seller's order page
// (OrderBuyerCard) — computed live from orders/claims/buyer_reviews on
// every read, same "review volume is tiny at this scale, don't cache it"
// reasoning as feedback.ListForSeller.
type Stats struct {
	BuysMade      int     `json:"buysMade"`
	RefundedCount int     `json:"refundedCount"`
	RefundedPct   float64 `json:"refundedPct"`
	ClaimsCount   int     `json:"claimsCount"`
	ClaimsPct     float64 `json:"claimsPct"`
	Tag           *string `json:"tag"`
	ReviewCount   int     `json:"reviewCount"`
	AverageRating float64 `json:"averageRating"`
}

func validTag(t string) bool { return validTags[t] }

// validQuarterRating mirrors the buyer_reviews_rating_check constraint
// (migration 0044): 1 to 5, in quarter-star steps — a seller can rate a
// buyer 4.25, 4.5, 4.75, etc. rather than being forced to round to a whole
// star. Quarters (0.25, 0.5, 0.75, 1.0) are exact in binary floating point,
// so this comparison never needs an epsilon.
func validQuarterRating(r float64) bool {
	if r < 1 || r > 5 {
		return false
	}
	quartered := r * 4
	return quartered == math.Round(quartered)
}

// saleState returns orderID's current state if it's a real order where
// sellerID actually sold to buyerID, and ok=false if it isn't (wrong
// buyer/seller for this order, or the order doesn't exist at all) — the
// single query Upsert needs to both authorize the reviewer and decide
// whether the sale is done, rather than feedback.go's two-way union, since
// an order already IS the sale record (unlike when seller_reviews was
// designed, before internal/order existed).
func saleState(ctx context.Context, pool *pgxpool.Pool, orderID, sellerID, buyerID string) (state string, ok bool, err error) {
	err = pool.QueryRow(ctx, `
		select state from orders where id = $1 and seller_id = $2 and buyer_id = $3
	`, orderID, sellerID, buyerID).Scan(&state)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("check sale: %w", err)
	}
	return state, true, nil
}

// orderComplete reports whether an order has actually finished, one way or
// the other — the seller's take released, or the buyer refunded. Everything
// before that (paid, awaiting_ship, shipped, delivered, claim_window, even
// claim_open) is still live: a seller shouldn't be able to rate a buyer's
// behavior before the transaction has actually played out, since a claim
// or a shipping problem can still change the story.
func orderComplete(state string) bool {
	return state == "released" || state == "refunded"
}

// Upsert claims or replaces reviewerID's (the seller's) review of buyerID
// on orderID. One review per order (buyer_reviews.order_id is unique) —
// resubmitting on the same order edits it in place, same shape as
// feedback.Upsert's per-purchase edit-in-place behavior. Gated on the order
// actually being complete (orderComplete), not just on it existing.
func Upsert(ctx context.Context, pool *pgxpool.Pool, orderID, sellerID, buyerID string, rating float64, tag, comment string) (*Review, error) {
	if sellerID == buyerID {
		return nil, ErrCannotReviewSelf
	}
	state, ok, err := saleState(ctx, pool, orderID, sellerID, buyerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotYourSale
	}
	if !orderComplete(state) {
		return nil, ErrOrderNotComplete
	}
	if !validQuarterRating(rating) {
		return nil, ErrInvalidRating
	}
	if !validTag(tag) {
		return nil, ErrInvalidTag
	}
	if len(comment) > maxCommentLength {
		return nil, ErrCommentTooLong
	}

	var commentArg *string
	if comment != "" {
		commentArg = &comment
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	err = tx.QueryRow(ctx, `
		insert into buyer_reviews (order_id, buyer_id, reviewer_id, rating, tag, comment)
		values ($1, $2, $3, $4, $5, $6)
		on conflict (order_id)
		do update set rating = excluded.rating, tag = excluded.tag, comment = excluded.comment, created_at = now()
		returning id
	`, orderID, buyerID, sellerID, rating, tag, commentArg).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("upsert buyer review: %w", err)
	}

	// order_items.listing_id is what notification.Create's FK needs — a
	// buyer review is naturally keyed by order (see the type comment
	// above), but the notifications table (shared with won/sold/outbid)
	// only ever points at a listing.
	var listingID string
	if err := tx.QueryRow(ctx, `select listing_id from order_items where order_id = $1`, orderID).Scan(&listingID); err != nil {
		return nil, fmt.Errorf("look up order's listing: %w", err)
	}
	if err := notification.Create(ctx, tx, buyerID, notification.KindBuyerReviewReceived, listingID); err != nil {
		return nil, fmt.Errorf("notify buyer of review: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return getReview(ctx, pool, id)
}

// PendingReviewCelebration is one review a recipient hasn't been shown a
// CelebrationToast pop-up for yet — the buyer-review side of
// auction.CelebrationItem, assembled into that shared shape by
// auction.PendingCelebrations rather than duplicated here. Structurally
// identical to feedback.PendingReviewCelebration; kept as its own local
// type rather than a shared import since the two packages otherwise have
// no reason to depend on each other.
type PendingReviewCelebration struct {
	ListingID string
	Title     string
	ImageURLs []string
	Rating    float64
}

// PendingBuyerReviewCelebrations returns every review of buyerID (as a
// buyer) that hasn't been celebrated yet, oldest first.
func PendingBuyerReviewCelebrations(ctx context.Context, pool *pgxpool.Pool, buyerID string) ([]PendingReviewCelebration, error) {
	rows, err := pool.Query(ctx, `
		select l.id, l.title, l.image_urls, r.rating
		from buyer_reviews r
		join order_items oi on oi.order_id = r.order_id
		join listings l on l.id = oi.listing_id
		where r.buyer_id = $1 and r.celebrated_at is null
		order by r.created_at asc
	`, buyerID)
	if err != nil {
		return nil, fmt.Errorf("query pending review celebrations: %w", err)
	}
	defer rows.Close()

	out := []PendingReviewCelebration{}
	for rows.Next() {
		var item PendingReviewCelebration
		if err := rows.Scan(&item.ListingID, &item.Title, &item.ImageURLs, &item.Rating); err != nil {
			return nil, fmt.Errorf("scan pending review celebration: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// AckBuyerReviewCelebration marks listingID's buyer review as shown to
// buyerID, so PendingBuyerReviewCelebrations never returns it again. Goes
// through order_items (buyer_reviews has no listing_id column of its own —
// see the Review type comment) rather than orderID directly, since the
// caller only ever has the listingId a CelebrationItem carries, same as
// every other celebration ack in this codebase.
func AckBuyerReviewCelebration(ctx context.Context, pool *pgxpool.Pool, buyerID, listingID string) error {
	if _, err := pool.Exec(ctx, `
		update buyer_reviews r set celebrated_at = now()
		from order_items oi
		where oi.order_id = r.order_id and oi.listing_id = $1
			and r.buyer_id = $2 and r.celebrated_at is null
	`, listingID, buyerID); err != nil {
		return fmt.Errorf("ack buyer review celebration: %w", err)
	}
	return nil
}

func getReview(ctx context.Context, pool *pgxpool.Pool, id string) (*Review, error) {
	var rv Review
	var createdAt time.Time
	err := pool.QueryRow(ctx, `
		select r.id, r.order_id, r.buyer_id, r.reviewer_id, l.title, r.rating, r.tag, r.comment, r.created_at
		from buyer_reviews r
		join order_items oi on oi.order_id = r.order_id
		join listings l on l.id = oi.listing_id
		where r.id = $1
	`, id).Scan(&rv.ID, &rv.OrderID, &rv.BuyerID, &rv.ReviewerID, &rv.ListingTitle, &rv.Rating, &rv.Tag, &rv.Comment, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrReviewNotFound
		}
		return nil, fmt.Errorf("query buyer review: %w", err)
	}
	rv.CreatedAt = createdAt.Format(time.RFC3339)
	return &rv, nil
}

// GetForOrder returns the seller's own review of this order's buyer, or nil
// (with no error) when they haven't left one yet — lets the frontend tell
// "no review yet" apart from a real failure.
func GetForOrder(ctx context.Context, pool *pgxpool.Pool, orderID string) (*Review, error) {
	var id string
	err := pool.QueryRow(ctx, `select id from buyer_reviews where order_id = $1`, orderID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("look up buyer review: %w", err)
	}
	return getReview(ctx, pool, id)
}

// mostCommonTag picks the plurality tag across a buyer's reviews — the one
// word shown next to their name on the order page. Ties break toward
// whichever tag happens to be iterated first; not worth a stable tiebreak
// rule at this review volume.
func mostCommonTag(counts map[string]int) *string {
	var best string
	var bestN int
	for tag, n := range counts {
		if n > bestN {
			best, bestN = tag, n
		}
	}
	if bestN == 0 {
		return nil
	}
	return &best
}

// StatsFor computes buyerID's buying-reputation summary: how many
// completed purchases, what fraction ended up refunded (full refund or any
// partial refund), what fraction had a claim opened on them, plus the
// review-derived average rating and plurality tag. All computed live, not
// cached — orders/claims/buyer_reviews are the actual record of truth
// (CLAUDE.md §5.4's "derive, don't cache as the only truth" principle,
// applied to buyer reputation the same way it's applied to seller tier).
func StatsFor(ctx context.Context, pool *pgxpool.Pool, buyerID string) (*Stats, error) {
	stats := &Stats{}

	var buysMade, refunded, claimed int
	err := pool.QueryRow(ctx, `
		select
			count(*),
			count(*) filter (where o.state = 'refunded' or o.refunded_cents > 0),
			count(*) filter (where exists (select 1 from claims c where c.order_id = o.id))
		from orders o
		where o.buyer_id = $1 and o.state not in ('created', 'payment_pending', 'cancelled')
	`, buyerID).Scan(&buysMade, &refunded, &claimed)
	if err != nil {
		return nil, fmt.Errorf("query buyer order stats: %w", err)
	}
	stats.BuysMade = buysMade
	stats.RefundedCount = refunded
	stats.ClaimsCount = claimed
	if buysMade > 0 {
		stats.RefundedPct = float64(refunded) / float64(buysMade) * 100
		stats.ClaimsPct = float64(claimed) / float64(buysMade) * 100
	}

	rows, err := pool.Query(ctx, `select rating, tag from buyer_reviews where buyer_id = $1`, buyerID)
	if err != nil {
		return nil, fmt.Errorf("query buyer reviews: %w", err)
	}
	defer rows.Close()

	tagCounts := map[string]int{}
	var ratingTotal float64
	for rows.Next() {
		var rating float64
		var tag string
		if err := rows.Scan(&rating, &tag); err != nil {
			return nil, fmt.Errorf("scan buyer review: %w", err)
		}
		ratingTotal += rating
		tagCounts[tag]++
		stats.ReviewCount++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if stats.ReviewCount > 0 {
		stats.AverageRating = ratingTotal / float64(stats.ReviewCount)
		stats.Tag = mostCommonTag(tagCounts)
	}
	return stats, nil
}
