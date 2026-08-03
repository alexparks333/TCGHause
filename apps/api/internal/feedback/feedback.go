package feedback

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidRating    = errors.New("rating must be between 1 and 5")
	ErrCommentTooLong   = errors.New("comment must be 1000 characters or fewer")
	ErrCannotReviewSelf = errors.New("you cannot review yourself")
	ErrNoPurchase       = errors.New("you can only review a seller after winning one of their auctions")
)

const maxCommentLength = 1000

// Review is one reviewer's rating+comment for a seller — one row per
// (seller, reviewer) pair, see Upsert.
type Review struct {
	ID               string  `json:"id"`
	SellerID         string  `json:"sellerId"`
	ReviewerID       string  `json:"reviewerId"`
	ReviewerUsername *string `json:"reviewerUsername"`
	Rating           int     `json:"rating"`
	Comment          *string `json:"comment"`
	CreatedAt        string  `json:"createdAt"`
}

type Summary struct {
	AverageRating float64  `json:"averageRating"`
	Count         int      `json:"count"`
	Reviews       []Review `json:"reviews"`
}

// HasWonAuctionFrom reports whether reviewerID has won at least one of
// sellerID's auctions after it ended — the closest honest "have you
// actually bought from this seller" signal available without a real
// Order/checkout system (fixed-price purchase is still just a disabled
// placeholder button, CLAUDE.md §8). An ended auction's high_bidder_id is
// its winner by definition — there's no separate winner_id column because
// none is needed (CLAUDE.md §6.1). Checks ends_at < now() directly rather
// than only trusting auctions.outcome = 'sold', so a win is recognized the
// instant the clock runs out rather than waiting up to one worker interval
// (cmd/worker, internal/auction/close.go) for the close pass to stamp it;
// l.status is deliberately not filtered here at all, since a listing can be
// either 'active' (not yet closed) or 'ended' (closed) by the time this
// runs and both are a legitimate win.
func HasWonAuctionFrom(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewerID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		select exists (
			select 1 from auctions a
			join listings l on l.id = a.listing_id
			where l.seller_id = $1 and a.high_bidder_id = $2 and a.ends_at < now()
		)
	`, sellerID, reviewerID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check purchase history: %w", err)
	}
	return exists, nil
}

// Upsert claims or replaces reviewerID's review of sellerID — one review
// per reviewer per seller (enforced by seller_reviews' unique constraint),
// so leaving a second review edits your first one rather than spamming
// duplicates. Gated on HasWonAuctionFrom — eBay's own model requires a
// completed transaction before you can leave feedback, and this is the
// closest we can honestly enforce that today.
func Upsert(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewerID string, rating int, comment string) (*Review, error) {
	if sellerID == reviewerID {
		return nil, ErrCannotReviewSelf
	}
	won, err := HasWonAuctionFrom(ctx, pool, sellerID, reviewerID)
	if err != nil {
		return nil, err
	}
	if !won {
		return nil, ErrNoPurchase
	}
	if rating < 1 || rating > 5 {
		return nil, ErrInvalidRating
	}
	if len(comment) > maxCommentLength {
		return nil, ErrCommentTooLong
	}

	var commentArg *string
	if comment != "" {
		commentArg = &comment
	}

	var rv Review
	var createdAt time.Time
	err = pool.QueryRow(ctx, `
		insert into seller_reviews (seller_id, reviewer_id, rating, comment)
		values ($1, $2, $3, $4)
		on conflict (seller_id, reviewer_id)
		do update set rating = excluded.rating, comment = excluded.comment, created_at = now()
		returning id, seller_id, reviewer_id, rating, comment, created_at
	`, sellerID, reviewerID, rating, commentArg).Scan(
		&rv.ID, &rv.SellerID, &rv.ReviewerID, &rv.Rating, &rv.Comment, &createdAt,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert review: %w", err)
	}
	rv.CreatedAt = createdAt.Format(time.RFC3339)
	return &rv, nil
}

// ListForSeller returns every review left for sellerID, newest first, with
// the average/count derived here rather than a second aggregate query —
// review volume is tiny at this scale (CLAUDE.md's "don't build ahead of
// real need" throughout).
func ListForSeller(ctx context.Context, pool *pgxpool.Pool, sellerID string) (*Summary, error) {
	rows, err := pool.Query(ctx, `
		select r.id, r.seller_id, r.reviewer_id, u.username, r.rating, r.comment, r.created_at
		from seller_reviews r
		join users u on u.id = r.reviewer_id
		where r.seller_id = $1
		order by r.created_at desc
	`, sellerID)
	if err != nil {
		return nil, fmt.Errorf("query reviews: %w", err)
	}
	defer rows.Close()

	summary := &Summary{Reviews: []Review{}}
	var ratingTotal int
	for rows.Next() {
		var rv Review
		var createdAt time.Time
		if err := rows.Scan(
			&rv.ID, &rv.SellerID, &rv.ReviewerID, &rv.ReviewerUsername, &rv.Rating, &rv.Comment, &createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan review: %w", err)
		}
		rv.CreatedAt = createdAt.Format(time.RFC3339)
		summary.Reviews = append(summary.Reviews, rv)
		ratingTotal += rv.Rating
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	summary.Count = len(summary.Reviews)
	if summary.Count > 0 {
		summary.AverageRating = float64(ratingTotal) / float64(summary.Count)
	}
	return summary, nil
}
