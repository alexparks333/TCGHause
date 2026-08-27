// Haus Trust is the one tier nothing in promotion.go can ever auto-grant —
// order volume, dispute rate, and review quality only ever qualify a
// seller to APPLY, never to be promoted into it directly (see
// volumeTierOrder in promotion.go). Getting in requires a real application,
// decided by a human, who also sets the seller's actual negotiated
// commission rate at approval time (there is no shared Haus Trust rate —
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
	ErrNotEligibleForHausTrust = errors.New("seller: not yet eligible to apply for Haus Trust")
	ErrApplicationPending      = errors.New("seller: a Haus Trust application is already pending")
	ErrApplicationNotFound     = errors.New("seller: haus trust application not found")
	ErrApplicationNotPending   = errors.New("seller: this application has already been decided")
	ErrInvalidGrantedPct       = errors.New("seller: granted percentage must be between 0 and 1")
)

// HausTrustApplicationStatus mirrors haus_trust_applications.status.
type HausTrustApplicationStatus string

const (
	ApplicationPending  HausTrustApplicationStatus = "pending"
	ApplicationApproved HausTrustApplicationStatus = "approved"
	ApplicationRejected HausTrustApplicationStatus = "rejected"
)

// HausTrustApplication is one seller's request, decided or not.
type HausTrustApplication struct {
	ID            string                     `json:"id"`
	SellerID      string                     `json:"sellerId"`
	Status        HausTrustApplicationStatus `json:"status"`
	RequestedAt   time.Time                  `json:"requestedAt"`
	DecidedAt     *time.Time                 `json:"decidedAt,omitempty"`
	DecidedBy     *string                    `json:"decidedBy,omitempty"`
	GrantedPct    *float64                   `json:"grantedPct,omitempty"`
	Note          *string                    `json:"note,omitempty"`
	CurrentTier   Tier                       `json:"currentTier"`
	ReviewCount   int                        `json:"reviewCount"`
	AverageRating float64                    `json:"averageRating"`
}

// ApplyForHausTrust records sellerID's request — checked against exactly
// the same eligibility bar promotion.go's gatesPass would use if Haus
// Trust were volume-reachable: must already be Platinum (there's no
// skipping a tier just by applying), must clear Haus Trust's review-count/
// average-rating floor (minReviewsForTier/minAverageRatingForTier,
// TierHausTrust entries), and must not already have a pending application.
// Deliberately does NOT check dispute rate or open-claim age here — those
// change day to day and are exactly the kind of thing a human reviewer
// should be looking at directly on the application, not a hard gate that
// silently blocks the "apply" button itself.
func ApplyForHausTrust(ctx context.Context, pool *pgxpool.Pool, sellerID string) (string, error) {
	tier, err := CurrentTier(ctx, pool, sellerID)
	if err != nil {
		return "", err
	}
	if tier != TierPlatinum {
		return "", ErrNotEligibleForHausTrust
	}

	count, average, err := reviewStats(ctx, pool, sellerID)
	if err != nil {
		return "", err
	}
	if count < minReviewsForTier[TierHausTrust] || average < minAverageRatingForTier[TierHausTrust] {
		return "", ErrNotEligibleForHausTrust
	}

	var pendingID string
	err = pool.QueryRow(ctx, `
		select id from haus_trust_applications where seller_id = $1 and status = 'pending'
	`, sellerID).Scan(&pendingID)
	if err == nil {
		return "", ErrApplicationPending
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("check pending application: %w", err)
	}

	var id string
	if err := pool.QueryRow(ctx, `
		insert into haus_trust_applications (seller_id) values ($1) returning id
	`, sellerID).Scan(&id); err != nil {
		return "", fmt.Errorf("insert haus trust application: %w", err)
	}
	return id, nil
}

const selectApplicationColumns = `
	a.id, a.seller_id, a.status, a.requested_at, a.decided_at, a.decided_by, a.granted_pct, a.note,
	u.tier, u.review_count, u.average_rating
`

func scanApplication(row pgx.Row) (*HausTrustApplication, error) {
	var a HausTrustApplication
	var tier string
	if err := row.Scan(
		&a.ID, &a.SellerID, &a.Status, &a.RequestedAt, &a.DecidedAt, &a.DecidedBy, &a.GrantedPct, &a.Note,
		&tier, &a.ReviewCount, &a.AverageRating,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApplicationNotFound
		}
		return nil, fmt.Errorf("scan haus trust application: %w", err)
	}
	a.CurrentTier = Tier(tier)
	return &a, nil
}

// ListHausTrustApplications backs the admin queue — status filters to one
// state ("pending" is the actual "needs a decision" queue); empty returns
// everything, newest first.
func ListHausTrustApplications(ctx context.Context, pool *pgxpool.Pool, status string) ([]HausTrustApplication, error) {
	query := `
		select ` + selectApplicationColumns + `
		from haus_trust_applications a
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
		return nil, fmt.Errorf("query haus trust applications: %w", err)
	}
	defer rows.Close()

	out := []HausTrustApplication{}
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// GetHausTrustApplication backs the admin decide screen.
func GetHausTrustApplication(ctx context.Context, pool *pgxpool.Pool, applicationID string) (*HausTrustApplication, error) {
	row := pool.QueryRow(ctx, `
		select `+selectApplicationColumns+`
		from haus_trust_applications a
		join users u on u.id = a.seller_id
		where a.id = $1
	`, applicationID)
	return scanApplication(row)
}

// DecideHausTrustApplication is the one and only way a seller ever
// actually becomes Haus Trust — approving requires grantedPct (the
// negotiated rate this specific seller will actually be charged; there is
// no default to fall back on except promotion.go's hausTrustFallbackPct,
// which exists for data-integrity reasons, not as a real rate anyone
// should be approved at). Rejecting just closes the application; the
// seller can apply again later.
func DecideHausTrustApplication(ctx context.Context, pool *pgxpool.Pool, applicationID, reviewerID string, approve bool, grantedPct float64, note string) error {
	a, err := GetHausTrustApplication(ctx, pool, applicationID)
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
		update haus_trust_applications
		set status = $1, decided_at = now(), decided_by = $2, granted_pct = $3, note = $4
		where id = $5
	`, string(status), reviewerID, pctArg, noteArg, applicationID); err != nil {
		return fmt.Errorf("record application decision: %w", err)
	}

	if !approve {
		return nil
	}

	if _, err := pool.Exec(ctx, `
		update users set tier = $1, tier_since = now(), haus_trust_custom_pct = $2 where id = $3
	`, string(TierHausTrust), grantedPct, a.SellerID); err != nil {
		return fmt.Errorf("promote seller to haus trust: %w", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into tier_events (seller_id, from_tier, to_tier, reason) values ($1, $2, $3, 'haus_trust_application_approved')
	`, a.SellerID, string(a.CurrentTier), string(TierHausTrust)); err != nil {
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
// full ladder (Haus Trust included — this is the one legitimate way to
// reach it outside a real application, purely so local testing can see
// what a Haus Trust seller's experience looks like without faking an
// entire application/approval flow). Bypasses every gate in promotion.go
// on purpose: this is a raw testing tool, not a promotion decision, so it
// still writes a tier_events row (reason "dev_adjust") for the same audit-
// trail reason every other tier change does, but never checks dispute
// rate, reviews, or account age. Nudging into Haus Trust sets a
// placeholder custom_pct (hausTrustFallbackPct) rather than leaving it
// null, since a real Haus Trust seller always has one; nudging back out
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

	if next == TierHausTrust {
		if _, err := pool.Exec(ctx, `update users set haus_trust_custom_pct = $1 where id = $2`, hausTrustFallbackPct, sellerID); err != nil {
			return "", fmt.Errorf("set placeholder haus trust pct: %w", err)
		}
	} else if current == TierHausTrust {
		if _, err := pool.Exec(ctx, `update users set haus_trust_custom_pct = null where id = $1`, sellerID); err != nil {
			return "", fmt.Errorf("clear haus trust pct: %w", err)
		}
	}

	if _, err := pool.Exec(ctx, `
		insert into tier_events (seller_id, from_tier, to_tier, reason) values ($1, $2, $3, 'dev_adjust')
	`, sellerID, string(current), string(next)); err != nil {
		return "", fmt.Errorf("insert tier event: %w", err)
	}

	return next, nil
}
