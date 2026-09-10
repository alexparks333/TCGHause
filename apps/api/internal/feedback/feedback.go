package feedback

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/notification"
)

var (
	ErrInvalidRating    = errors.New("every rating axis must be between 1 and 5")
	ErrCommentTooLong   = errors.New("comment must be 1000 characters or fewer")
	ErrCannotReviewSelf = errors.New("you cannot review yourself")
	ErrNoPurchase       = errors.New("you can only review a seller after buying something from them")
	ErrReplyTooLong     = errors.New("reply must be 1000 characters or fewer")
	ErrReplyRequired    = errors.New("reply cannot be empty")
	ErrNotYourReview    = errors.New("you can only reply to reviews of your own seller account")
	ErrReviewNotFound   = errors.New("review not found")
)

const maxCommentLength = 1000
const maxReplyLength = 1000

// Review is one reviewer's rating+comment for a seller, tied to the one
// purchase (won auction) it's about — one row per (reviewer, listing)
// pair, see Upsert. Rating is split into three axes (product decision,
// CLAUDE.md §6.3 sketches four long-term) rather than one overall
// star score; OverallRating is derived (mean of the three), never stored.
// SellerReply is at most one reply from the seller being reviewed —
// re-submitting replaces it, there's no threading.
type Review struct {
	ID                  string  `json:"id"`
	SellerID            string  `json:"sellerId"`
	ReviewerID          string  `json:"reviewerId"`
	ReviewerUsername    *string `json:"reviewerUsername"`
	ReviewerReviewCount int     `json:"reviewerReviewCount"`
	ListingID           string  `json:"listingId"`
	ListingTitle        string  `json:"listingTitle"`
	ConditionAccuracy   int     `json:"conditionAccuracy"`
	ShippingSpeed       int     `json:"shippingSpeed"`
	Trustworthiness     int     `json:"trustworthiness"`
	OverallRating       float64 `json:"overallRating"`
	Comment             *string `json:"comment"`
	CreatedAt           string  `json:"createdAt"`
	SellerReply         *string `json:"sellerReply"`
	SellerReplyAt       *string `json:"sellerReplyAt,omitempty"`
}

// Summary's per-axis averages are what actually let a buyer tell "great
// cards, slow shipping" apart from "fast shipping, iffy grading" at a
// glance — the entire point of splitting the rating into axes instead of
// one blended number.
type Summary struct {
	AverageRating            float64  `json:"averageRating"`
	AverageConditionAccuracy float64  `json:"averageConditionAccuracy"`
	AverageShippingSpeed     float64  `json:"averageShippingSpeed"`
	AverageTrustworthiness   float64  `json:"averageTrustworthiness"`
	Count                    int      `json:"count"`
	Reviews                  []Review `json:"reviews"`
}

// EligibleListing is one of reviewerID's purchases from sellerID that
// doesn't have a review yet — exactly the set of listings the reviewer is
// allowed to leave a new review against right now.
type EligibleListing struct {
	ListingID string    `json:"listingId"`
	Title     string    `json:"title"`
	EndedAt   time.Time `json:"endedAt"`
}

// EligibleListingsToReview returns every purchase reviewerID made from
// sellerID that reviewerID hasn't already reviewed — the real data behind
// both "can this person leave a review at all" (len > 0) and "which
// purchase are they reviewing" (the picker in the review form). Two ways
// to have bought something, unioned: winning an auction (outcome 'sold'
// via bidding, or 'bought_now' via Buy It Now — both count, checked via
// outcome directly rather than re-deriving from ends_at, since a Buy It
// Now purchase closes an auction before its clock runs out) or buying a
// fixed-format listing outright (listings.buyer_id).
func EligibleListingsToReview(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewerID string) ([]EligibleListing, error) {
	rows, err := pool.Query(ctx, `
		select l.id, l.title, coalesce(a.closed_at, l.sold_at) as ended_at
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.seller_id = $1
			and (
				(a.high_bidder_id = $2 and a.outcome in ('sold', 'bought_now'))
				or l.buyer_id = $2
			)
			and not exists (
				select 1 from seller_reviews r
				where r.reviewer_id = $2 and r.listing_id = l.id
			)
		order by coalesce(a.closed_at, l.sold_at) desc
	`, sellerID, reviewerID)
	if err != nil {
		return nil, fmt.Errorf("query eligible listings: %w", err)
	}
	defer rows.Close()

	out := []EligibleListing{}
	for rows.Next() {
		var el EligibleListing
		if err := rows.Scan(&el.ListingID, &el.Title, &el.EndedAt); err != nil {
			return nil, fmt.Errorf("scan eligible listing: %w", err)
		}
		out = append(out, el)
	}
	return out, rows.Err()
}

// wonListingFrom reports whether reviewerID actually bought listingID (won
// its auction, however it sold, or bought it outright as a fixed-format
// listing), and that listingID actually belongs to sellerID — the
// per-purchase gate Upsert enforces, replacing the old seller-wide
// HasWonAuctionFrom. Same union as EligibleListingsToReview above; kept in
// sync deliberately, since this is the one that actually decides whether
// a submitted review is allowed to save, not just what the picker shows.
func wonListingFrom(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewerID, listingID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		select exists (
			select 1 from listings l
			left join auctions a on a.listing_id = l.id
			where l.id = $1 and l.seller_id = $2
				and (
					(a.high_bidder_id = $3 and a.outcome in ('sold', 'bought_now'))
					or l.buyer_id = $3
				)
		)
	`, listingID, sellerID, reviewerID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check purchase: %w", err)
	}
	return exists, nil
}

func validAxis(n int) bool {
	return n >= 1 && n <= 5
}

// Upsert claims or replaces reviewerID's review of one specific purchase
// (listingID) from sellerID — one review per (reviewer, listing) pair
// (enforced by seller_reviews' unique constraint), so leaving a second
// review of the *same* purchase edits the first one, but a different won
// auction from the same seller is a brand new, independent review. Gated
// on wonListingFrom — eBay's own model requires a completed transaction
// before you can leave feedback, applied here per-transaction rather than
// per-seller.
func Upsert(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewerID, listingID string, conditionAccuracy, shippingSpeed, trustworthiness int, comment string) (*Review, error) {
	if sellerID == reviewerID {
		return nil, ErrCannotReviewSelf
	}
	won, err := wonListingFrom(ctx, pool, sellerID, reviewerID, listingID)
	if err != nil {
		return nil, err
	}
	if !won {
		return nil, ErrNoPurchase
	}
	if !validAxis(conditionAccuracy) || !validAxis(shippingSpeed) || !validAxis(trustworthiness) {
		return nil, ErrInvalidRating
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
		insert into seller_reviews
			(seller_id, reviewer_id, listing_id, condition_accuracy, shipping_speed, trustworthiness, comment)
		values ($1, $2, $3, $4, $5, $6, $7)
		on conflict (reviewer_id, listing_id)
		do update set
			condition_accuracy = excluded.condition_accuracy,
			shipping_speed = excluded.shipping_speed,
			trustworthiness = excluded.trustworthiness,
			comment = excluded.comment,
			created_at = now()
		returning id
	`, sellerID, reviewerID, listingID, conditionAccuracy, shippingSpeed, trustworthiness, commentArg).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("upsert review: %w", err)
	}

	if err := notification.Create(ctx, tx, sellerID, notification.KindSellerReviewReceived, listingID); err != nil {
		return nil, fmt.Errorf("notify seller of review: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	// Re-fetch through the same fully-joined query every other read path
	// uses (username, reviewer's total review count, listing title) rather
	// than duplicating that join here and risking the two drifting apart.
	return getReview(ctx, pool, id)
}

func overallOf(conditionAccuracy, shippingSpeed, trustworthiness int) float64 {
	return float64(conditionAccuracy+shippingSpeed+trustworthiness) / 3
}

// PendingReviewCelebration is one review a recipient hasn't been shown a
// CelebrationToast pop-up for yet — the review side of
// auction.CelebrationItem, assembled into that shared shape by
// auction.PendingCelebrations rather than duplicated here.
type PendingReviewCelebration struct {
	ListingID string
	Title     string
	ImageURLs []string
	Rating    float64
}

// PendingSellerReviewCelebrations returns every review of sellerID (as a
// seller) that hasn't been celebrated yet, oldest first — same FIFO
// ordering as auction.PendingCelebrations' win/sale queries.
func PendingSellerReviewCelebrations(ctx context.Context, pool *pgxpool.Pool, sellerID string) ([]PendingReviewCelebration, error) {
	rows, err := pool.Query(ctx, `
		select l.id, l.title, l.image_urls, r.condition_accuracy, r.shipping_speed, r.trustworthiness
		from seller_reviews r
		join listings l on l.id = r.listing_id
		where r.seller_id = $1 and r.celebrated_at is null
		order by r.created_at asc
	`, sellerID)
	if err != nil {
		return nil, fmt.Errorf("query pending review celebrations: %w", err)
	}
	defer rows.Close()

	out := []PendingReviewCelebration{}
	for rows.Next() {
		var item PendingReviewCelebration
		var conditionAccuracy, shippingSpeed, trustworthiness int
		if err := rows.Scan(&item.ListingID, &item.Title, &item.ImageURLs, &conditionAccuracy, &shippingSpeed, &trustworthiness); err != nil {
			return nil, fmt.Errorf("scan pending review celebration: %w", err)
		}
		item.Rating = overallOf(conditionAccuracy, shippingSpeed, trustworthiness)
		out = append(out, item)
	}
	return out, rows.Err()
}

// AckSellerReviewCelebration marks listingID's seller review as shown to
// sellerID, so PendingSellerReviewCelebrations never returns it again. A
// no-op (not an error) if there's no such un-celebrated review — same
// "nothing to distinguish for a legitimate caller" reasoning as
// auction.AckCelebration.
func AckSellerReviewCelebration(ctx context.Context, pool *pgxpool.Pool, sellerID, listingID string) error {
	if _, err := pool.Exec(ctx, `
		update seller_reviews set celebrated_at = now()
		where listing_id = $1 and seller_id = $2 and celebrated_at is null
	`, listingID, sellerID); err != nil {
		return fmt.Errorf("ack seller review celebration: %w", err)
	}
	return nil
}

// AddReply lets sellerID reply to one of their own reviews (reviewID) —
// exactly one reply per review; calling this again on the same review
// replaces the existing reply rather than adding a second one, since
// there's no threading, just a single rebuttal/thank-you slot.
func AddReply(ctx context.Context, pool *pgxpool.Pool, sellerID, reviewID, reply string) (*Review, error) {
	if reply == "" {
		return nil, ErrReplyRequired
	}
	if len(reply) > maxReplyLength {
		return nil, ErrReplyTooLong
	}

	tag, err := pool.Exec(ctx, `
		update seller_reviews
		set seller_reply = $1, seller_reply_at = now()
		where id = $2 and seller_id = $3
	`, reply, reviewID, sellerID)
	if err != nil {
		return nil, fmt.Errorf("update reply: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either the review doesn't exist, or it exists but belongs to a
		// different seller — same response either way so a caller can't
		// use this to probe which reviews exist for another account.
		var exists bool
		if err := pool.QueryRow(ctx, `select exists (select 1 from seller_reviews where id = $1)`, reviewID).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check review exists: %w", err)
		}
		if !exists {
			return nil, ErrReviewNotFound
		}
		return nil, ErrNotYourReview
	}

	return getReview(ctx, pool, reviewID)
}

func getReview(ctx context.Context, pool *pgxpool.Pool, reviewID string) (*Review, error) {
	var rv Review
	var createdAt time.Time
	var replyAt *time.Time
	err := pool.QueryRow(ctx, `
		select r.id, r.seller_id, r.reviewer_id, u.username,
			(select count(*) from seller_reviews sr2 where sr2.reviewer_id = r.reviewer_id),
			r.listing_id, l.title, r.condition_accuracy, r.shipping_speed, r.trustworthiness,
			r.comment, r.created_at, r.seller_reply, r.seller_reply_at
		from seller_reviews r
		join users u on u.id = r.reviewer_id
		join listings l on l.id = r.listing_id
		where r.id = $1
	`, reviewID).Scan(
		&rv.ID, &rv.SellerID, &rv.ReviewerID, &rv.ReviewerUsername, &rv.ReviewerReviewCount,
		&rv.ListingID, &rv.ListingTitle, &rv.ConditionAccuracy, &rv.ShippingSpeed, &rv.Trustworthiness,
		&rv.Comment, &createdAt, &rv.SellerReply, &replyAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrReviewNotFound
		}
		return nil, fmt.Errorf("query review: %w", err)
	}
	rv.CreatedAt = createdAt.Format(time.RFC3339)
	rv.OverallRating = overallOf(rv.ConditionAccuracy, rv.ShippingSpeed, rv.Trustworthiness)
	if replyAt != nil {
		s := replyAt.Format(time.RFC3339)
		rv.SellerReplyAt = &s
	}
	return &rv, nil
}

// ListForSeller returns every review left for sellerID, newest first, with
// the averages derived here rather than a second aggregate query — review
// volume is tiny at this scale (CLAUDE.md's "don't build ahead of real
// need" throughout). ReviewerReviewCount (how many reviews that reviewer
// has written in total, across every seller) is surfaced next to their
// name so a reviewer's own track record is visible too, not just the
// seller's — the same reasoning eBay's own feedback-count-next-to-username
// convention exists for: a one-off drive-by review reads differently than
// one from someone with a long review history.
func ListForSeller(ctx context.Context, pool *pgxpool.Pool, sellerID string) (*Summary, error) {
	rows, err := pool.Query(ctx, `
		select r.id, r.seller_id, r.reviewer_id, u.username,
			(select count(*) from seller_reviews sr2 where sr2.reviewer_id = r.reviewer_id),
			r.listing_id, l.title, r.condition_accuracy, r.shipping_speed, r.trustworthiness,
			r.comment, r.created_at, r.seller_reply, r.seller_reply_at
		from seller_reviews r
		join users u on u.id = r.reviewer_id
		join listings l on l.id = r.listing_id
		where r.seller_id = $1
		order by r.created_at desc
	`, sellerID)
	if err != nil {
		return nil, fmt.Errorf("query reviews: %w", err)
	}
	defer rows.Close()

	summary := &Summary{Reviews: []Review{}}
	var conditionTotal, shippingTotal, trustTotal int
	for rows.Next() {
		var rv Review
		var createdAt time.Time
		var replyAt *time.Time
		if err := rows.Scan(
			&rv.ID, &rv.SellerID, &rv.ReviewerID, &rv.ReviewerUsername, &rv.ReviewerReviewCount,
			&rv.ListingID, &rv.ListingTitle, &rv.ConditionAccuracy, &rv.ShippingSpeed, &rv.Trustworthiness,
			&rv.Comment, &createdAt, &rv.SellerReply, &replyAt,
		); err != nil {
			return nil, fmt.Errorf("scan review: %w", err)
		}
		rv.CreatedAt = createdAt.Format(time.RFC3339)
		rv.OverallRating = overallOf(rv.ConditionAccuracy, rv.ShippingSpeed, rv.Trustworthiness)
		if replyAt != nil {
			s := replyAt.Format(time.RFC3339)
			rv.SellerReplyAt = &s
		}
		summary.Reviews = append(summary.Reviews, rv)
		conditionTotal += rv.ConditionAccuracy
		shippingTotal += rv.ShippingSpeed
		trustTotal += rv.Trustworthiness
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	summary.Count = len(summary.Reviews)
	if summary.Count > 0 {
		n := float64(summary.Count)
		summary.AverageConditionAccuracy = float64(conditionTotal) / n
		summary.AverageShippingSpeed = float64(shippingTotal) / n
		summary.AverageTrustworthiness = float64(trustTotal) / n
		summary.AverageRating = (summary.AverageConditionAccuracy + summary.AverageShippingSpeed + summary.AverageTrustworthiness) / 3
	}
	return summary, nil
}
