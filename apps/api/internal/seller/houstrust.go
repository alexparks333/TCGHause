// Hous Trust is the one tier nothing in promotion.go can ever auto-grant —
// order volume, dispute rate, and review quality only ever qualify a
// seller to APPLY, never to be promoted into it directly (see
// volumeTierOrder in promotion.go). Getting in requires a real application,
// decided by a human, who also sets the seller's actual negotiated
// commission rate at approval time (there is no shared Hous Trust rate —
// see tier.go's PctForSeller).
package seller

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotEligibleForHousTrust = errors.New("seller: not yet eligible to apply for Hous Trust")
	ErrApplicationPending      = errors.New("seller: a Hous Trust application is already pending")
	ErrApplicationNotFound     = errors.New("seller: hous trust application not found")
	ErrApplicationNotPending   = errors.New("seller: this application has already been decided")
	ErrInvalidGrantedPct       = errors.New("seller: granted percentage must be between 0 and 1")
)

// HousTrustApplicationStatus mirrors hous_trust_applications.status.
type HousTrustApplicationStatus string

const (
	ApplicationPending  HousTrustApplicationStatus = "pending"
	ApplicationApproved HousTrustApplicationStatus = "approved"
	ApplicationRejected HousTrustApplicationStatus = "rejected"
)

// HousTrustApplication is one seller's request, decided or not.
type HousTrustApplication struct {
	ID            string                     `json:"id"`
	SellerID      string                     `json:"sellerId"`
	Status        HousTrustApplicationStatus `json:"status"`
	RequestedAt   time.Time                  `json:"requestedAt"`
	DecidedAt     *time.Time                 `json:"decidedAt,omitempty"`
	DecidedBy     *string                    `json:"decidedBy,omitempty"`
	GrantedPct    *float64                   `json:"grantedPct,omitempty"`
	Note          *string                    `json:"note,omitempty"`
	CurrentTier   Tier                       `json:"currentTier"`
	ReviewCount   int                        `json:"reviewCount"`
	AverageRating float64                    `json:"averageRating"`
}

// ApplyForHousTrust records sellerID's request — checked against exactly
// the same eligibility bar promotion.go's gatesPass would use if Hous
// Trust were volume-reachable: must already be Platinum (there's no
// skipping a tier just by applying), must clear Hous Trust's review-count/
// average-rating floor (minReviewsForTier/minAverageRatingForTier,
// TierHousTrust entries), and must not already have a pending application.
// Deliberately does NOT check dispute rate or open-claim age here — those
// change day to day and are exactly the kind of thing a human reviewer
// should be looking at directly on the application, not a hard gate that
// silently blocks the "apply" button itself.
func ApplyForHousTrust(ctx context.Context, pool *pgxpool.Pool, sellerID string) (string, error) {
	tier, err := CurrentTier(ctx, pool, sellerID)
	if err != nil {
		return "", err
	}
	if tier != TierPlatinum {
		return "", ErrNotEligibleForHousTrust
	}

	count, average, err := reviewStats(ctx, pool, sellerID)
	if err != nil {
		return "", err
	}
	if count < minReviewsForTier[TierHousTrust] || average < minAverageRatingForTier[TierHousTrust] {
		return "", ErrNotEligibleForHousTrust
	}

	var pendingID string
	err = pool.QueryRow(ctx, `
		select id from hous_trust_applications where seller_id = $1 and status = 'pending'
	`, sellerID).Scan(&pendingID)
	if err == nil {
		return "", ErrApplicationPending
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("check pending application: %w", err)
	}

	var id string
	if err := pool.QueryRow(ctx, `
		insert into hous_trust_applications (seller_id) values ($1) returning id
	`, sellerID).Scan(&id); err != nil {
		return "", fmt.Errorf("insert hous trust application: %w", err)
	}
	return id, nil
}

const selectApplicationColumns = `
	a.id, a.seller_id, a.status, a.requested_at, a.decided_at, a.decided_by, a.granted_pct, a.note,
	u.tier, u.review_count, u.average_rating
`

func scanApplication(row pgx.Row) (*HousTrustApplication, error) {
	var a HousTrustApplication
	var tier string
	if err := row.Scan(
		&a.ID, &a.SellerID, &a.Status, &a.RequestedAt, &a.DecidedAt, &a.DecidedBy, &a.GrantedPct, &a.Note,
		&tier, &a.ReviewCount, &a.AverageRating,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApplicationNotFound
		}
		return nil, fmt.Errorf("scan hous trust application: %w", err)
	}
	a.CurrentTier = Tier(tier)
	return &a, nil
}

// ListHousTrustApplications backs the admin queue — status filters to one
// state ("pending" is the actual "needs a decision" queue); empty returns
// everything, newest first.
func ListHousTrustApplications(ctx context.Context, pool *pgxpool.Pool, status string) ([]HousTrustApplication, error) {
	query := `
		select ` + selectApplicationColumns + `
		from hous_trust_applications a
		join users u on u.id = a.seller_id
	`
	var rows pgx.Rows
	var err error
	if status != "" {
		rows, err = pool.Query(ctx, query+` where a.status = $1 order by a.requested_at desc`, status)
	} else {
		rows, err = pool.Query(ctx, query+` order by a.requested_at desc`)
	}
	if err != nil {
		return nil, fmt.Errorf("query hous trust applications: %w", err)
	}
	defer rows.Close()

	out := []HousTrustApplication{}
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// GetHousTrustApplication backs the admin decide screen.
func GetHousTrustApplication(ctx context.Context, pool *pgxpool.Pool, applicationID string) (*HousTrustApplication, error) {
	row := pool.QueryRow(ctx, `
		select `+selectApplicationColumns+`
		from hous_trust_applications a
		join users u on u.id = a.seller_id
		where a.id = $1
	`, applicationID)
	return scanApplication(row)
}

// DecideHousTrustApplication is the one and only way a seller ever
// actually becomes Hous Trust — approving requires grantedPct (the
// negotiated rate this specific seller will actually be charged; there is
// no default to fall back on except promotion.go's housTrustFallbackPct,
// which exists for data-integrity reasons, not as a real rate anyone
// should be approved at). Rejecting just closes the application; the
// seller can apply again later.
func DecideHousTrustApplication(ctx context.Context, pool *pgxpool.Pool, applicationID, reviewerID string, approve bool, grantedPct float64, note string) error {
	a, err := GetHousTrustApplication(ctx, pool, applicationID)
	if err != nil {
		return err
	}
	if a.Status != ApplicationPending {
		return ErrApplicationNotPending
	}

	status := ApplicationRejected
	if approve {
		if grantedPct <= 0 || grantedPct >= 1 {
			return ErrInvalidGrantedPct
		}
		status = ApplicationApproved
	}

	var noteArg *string
	if note != "" {
		noteArg = &note
	}
	var pctArg *float64
	if approve {
		pctArg = &grantedPct
	}
	if _, err := pool.Exec(ctx, `
		update hous_trust_applications
		set status = $1, decided_at = now(), decided_by = $2, granted_pct = $3, note = $4
		where id = $5
	`, string(status), reviewerID, pctArg, noteArg, applicationID); err != nil {
		return fmt.Errorf("record application decision: %w", err)
	}

	if !approve {
		return nil
	}

	if _, err := pool.Exec(ctx, `
		update users set tier = $1, tier_since = now(), hous_trust_custom_pct = $2 where id = $3
	`, string(TierHousTrust), grantedPct, a.SellerID); err != nil {
		return fmt.Errorf("promote seller to hous trust: %w", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into tier_events (seller_id, from_tier, to_tier, reason) values ($1, $2, $3, 'hous_trust_application_approved')
	`, a.SellerID, string(a.CurrentTier), string(TierHousTrust)); err != nil {
		return fmt.Errorf("insert tier event: %w", err)
	}
	return nil
}

// AllowDevTierAdjust gates DevAdjustTier — set once at boot from
// platform.Config.Environment (cmd/api/main.go, alongside
// listing.AllowDevDurations/AllowMissingPhotos), never flipped per-request.
// Off in production regardless of whether a client somehow reaches the
// route at all — belt-and-suspenders, same shape as the dev-quick-switch
// route's own explicit re-check.
var AllowDevTierAdjust = true

// ErrDevTierAdjustDisabled is returned by DevAdjustTier when
// AllowDevTierAdjust is false.
var ErrDevTierAdjustDisabled = errors.New("seller: dev tier adjustment is disabled outside development")

// ErrAlreadyAtTop/ErrAlreadyAtBottom make the dev panel's up/down arrows
// disable cleanly instead of erroring confusingly at the ladder's ends.
var (
	ErrAlreadyAtTop    = errors.New("seller: already at the top tier")
	ErrAlreadyAtBottom = errors.New("seller: already at the bottom tier")
)

// DevAdjustTier moves sellerID exactly one step up or down tierOrder's
// full ladder (Hous Trust included — this is the one legitimate way to
// reach it outside a real application, purely so local testing can see
// what a Hous Trust seller's experience looks like without faking an
// entire application/approval flow). Bypasses every gate in promotion.go
// on purpose: this is a raw testing tool, not a promotion decision, so it
// still writes a tier_events row (reason "dev_adjust") for the same audit-
// trail reason every other tier change does, but never checks dispute
// rate, reviews, or account age. Nudging into Hous Trust sets a
// placeholder custom_pct (housTrustFallbackPct) rather than leaving it
// null, since a real Hous Trust seller always has one; nudging back out
// clears it, same as a real demotion.
func DevAdjustTier(ctx context.Context, pool *pgxpool.Pool, sellerID, direction string) (Tier, error) {
	if !AllowDevTierAdjust {
		return "", ErrDevTierAdjustDisabled
	}

	current, err := CurrentTier(ctx, pool, sellerID)
	if err != nil {
		return "", err
	}
	idx := tierIndex(current)

	var next Tier
	switch direction {
	case "up":
		if idx >= len(tierOrder)-1 {
			return "", ErrAlreadyAtTop
		}
		next = tierOrder[idx+1]
	case "down":
		if idx <= 0 {
			return "", ErrAlreadyAtBottom
		}
		next = tierOrder[idx-1]
	default:
		return "", fmt.Errorf("seller: invalid direction %q, want \"up\" or \"down\"", direction)
	}

	if _, err := pool.Exec(ctx, `update users set tier = $1, tier_since = now() where id = $2`, string(next), sellerID); err != nil {
		return "", fmt.Errorf("update seller tier: %w", err)
	}

	if next == TierHousTrust {
		if _, err := pool.Exec(ctx, `update users set hous_trust_custom_pct = $1 where id = $2`, housTrustFallbackPct, sellerID); err != nil {
			return "", fmt.Errorf("set placeholder hous trust pct: %w", err)
		}
	} else if current == TierHousTrust {
		if _, err := pool.Exec(ctx, `update users set hous_trust_custom_pct = null where id = $1`, sellerID); err != nil {
			return "", fmt.Errorf("clear hous trust pct: %w", err)
		}
	}

	if _, err := pool.Exec(ctx, `
		insert into tier_events (seller_id, from_tier, to_tier, reason) values ($1, $2, $3, 'dev_adjust')
	`, sellerID, string(current), string(next)); err != nil {
		return "", fmt.Errorf("insert tier event: %w", err)
	}

	return next, nil
}
