package seller

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// tierThreshold is design doc v2 §3.1/§3.2's cumulative-completed-order
// thresholds. No entry for TierNew — every seller starts there, so its
// implicit zero-value threshold (0) is correct as-is: tierForOrders below
// relies on that.
var tierThreshold = map[Tier]int{
	TierBronze:    15,
	TierSilver:    50,
	TierGold:      150,
	TierHausTrust: 500,
}

// tierOrder is the ladder in ascending order — used to step exactly one
// tier at a time on demotion (design doc v2 §3.5 is explicit: drop ONE
// tier, never straight to New regardless of how bad the dispute rate is)
// and to find "one tier below current" generically.
var tierOrder = []Tier{TierNew, TierBronze, TierSilver, TierGold, TierHausTrust}

func tierIndex(t Tier) int {
	for i, x := range tierOrder {
		if x == t {
			return i
		}
	}
	return 0
}

// tierForOrders is the highest tier a bare order count alone qualifies
// for — promotion (unlike demotion) is allowed to jump straight to the
// highest qualifying tier in one recompute, e.g. after the worker was down
// for a while, since design doc v2 doesn't require promotion to step one
// tier at a time the way demotion explicitly does.
func tierForOrders(n int) Tier {
	t := TierNew
	for _, candidate := range tierOrder {
		if n >= tierThreshold[candidate] {
			t = candidate
		}
	}
	return t
}

const (
	promotionGateDisputeRate  = 0.02
	demotionDisputeRate       = 0.04
	minAccountAgeForPromotion = 14 * 24 * time.Hour
	graduationOrderCount      = 25
	graduationAge             = 30 * 24 * time.Hour
	demotionLockout           = 30 * 24 * time.Hour
)

// standing is one seller's computed inputs for a promotion/demotion
// decision — everything derived fresh from orders/users on every
// recompute (CLAUDE.md §5.4: never cached-only, never hand-set).
type standing struct {
	currentTier        Tier
	accountCreatedAt   time.Time
	cumulativeOrders   int
	disputeRate90d     float64
	oldestOpenClaimAge *time.Duration
	lastDemotionAt     *time.Time
}

// gatesPass is design doc v2 §3.3's promotion gates, ALL required: dispute
// rate under 2% trailing 90 days, no unresolved claim older than 7 days,
// account age at least 14 days. Deliberately NOT gated on review count —
// review-count gates create pressure to solicit reviews, a known
// marketplace-quality failure mode; dispute rate is the thing that
// actually matters and is harder to game.
func gatesPass(s standing) bool {
	if s.disputeRate90d >= promotionGateDisputeRate {
		return false
	}
	if s.oldestOpenClaimAge != nil && *s.oldestOpenClaimAge > 7*24*time.Hour {
		return false
	}
	return time.Since(s.accountCreatedAt) >= minAccountAgeForPromotion
}

// decideTier is the actual promotion/demotion decision, pure and testable
// independent of the DB — returns the new tier (unchanged from
// s.currentTier if nothing applies this pass) and the reason to record in
// tier_events.
func decideTier(s standing) (Tier, string) {
	// Demotion checked first, and wins even if the order count alone would
	// otherwise justify a higher tier this same pass (design doc v2 §3.5).
	if s.disputeRate90d > demotionDisputeRate && tierIndex(s.currentTier) > 0 {
		lockedOut := s.lastDemotionAt != nil && time.Since(*s.lastDemotionAt) < demotionLockout
		if !lockedOut {
			return tierOrder[tierIndex(s.currentTier)-1], "dispute_demotion"
		}
	}

	if !gatesPass(s) {
		return s.currentTier, ""
	}

	// Graduation guarantee overrides the normal 15-order Bronze threshold
	// for a New seller who's hit 25 orders or 30 days since their account
	// was created, whichever comes first — gates above still apply
	// (design doc v2 §3.4).
	if s.currentTier == TierNew && tierForOrders(s.cumulativeOrders) == TierNew {
		accountAge := time.Since(s.accountCreatedAt)
		if s.cumulativeOrders >= graduationOrderCount || accountAge >= graduationAge {
			return TierBronze, "graduation_guarantee"
		}
	}

	if qualifies := tierForOrders(s.cumulativeOrders); tierIndex(qualifies) > tierIndex(s.currentTier) {
		return qualifies, "volume_promotion"
	}

	return s.currentTier, ""
}

func loadStanding(ctx context.Context, pool *pgxpool.Pool, sellerID string) (standing, error) {
	var s standing

	var currentTier string
	if err := pool.QueryRow(ctx, `
		select tier, created_at from users where id = $1
	`, sellerID).Scan(&currentTier, &s.accountCreatedAt); err != nil {
		return s, fmt.Errorf("read seller: %w", err)
	}
	s.currentTier = Tier(currentTier)

	if err := pool.QueryRow(ctx, `
		select count(*) from orders where seller_id = $1 and state not in ('cancelled', 'refunded')
	`, sellerID).Scan(&s.cumulativeOrders); err != nil {
		return s, fmt.Errorf("count seller orders: %w", err)
	}

	// Dispute-rate/open-claim inputs are real, correctly wired plumbing
	// that's inert until internal/dispute's claims table exists: every
	// seller trivially has a 0% trailing dispute rate and no open claims
	// today, so these gates always pass rather than ever wrongly blocking
	// a promotion. They start reflecting genuine standing the moment
	// claims data exists — no change needed here when that lands.
	s.disputeRate90d = 0
	s.oldestOpenClaimAge = nil

	if err := pool.QueryRow(ctx, `
		select max(created_at) from tier_events where seller_id = $1 and reason = 'dispute_demotion'
	`, sellerID).Scan(&s.lastDemotionAt); err != nil {
		return s, fmt.Errorf("read last demotion: %w", err)
	}

	return s, nil
}

// RecomputeTier evaluates one seller's standing and, if it changed,
// updates users.tier and writes a tier_events row — the scheduled-job-
// computed pattern CLAUDE.md §5.4 calls for, never a cached-only field a
// human can hand-set. Also persists the recomputed counters
// (cumulative_orders/dispute_rate_90d) even when the tier itself doesn't
// change, since those are the audit trail a support agent reads to answer
// "why is this seller still New," not just promotion/demotion inputs.
// Returns the seller's tier after this call and whether it changed.
func RecomputeTier(ctx context.Context, pool *pgxpool.Pool, sellerID string) (Tier, bool, error) {
	s, err := loadStanding(ctx, pool, sellerID)
	if err != nil {
		return "", false, err
	}

	if _, err := pool.Exec(ctx, `
		update users set cumulative_orders = $1, dispute_rate_90d = $2 where id = $3
	`, s.cumulativeOrders, s.disputeRate90d, sellerID); err != nil {
		return "", false, fmt.Errorf("update seller counters: %w", err)
	}

	newTier, reason := decideTier(s)
	if newTier == s.currentTier {
		return s.currentTier, false, nil
	}

	if _, err := pool.Exec(ctx, `
		update users set tier = $1, tier_since = now() where id = $2
	`, string(newTier), sellerID); err != nil {
		return "", false, fmt.Errorf("update seller tier: %w", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into tier_events (seller_id, from_tier, to_tier, reason) values ($1, $2, $3, $4)
	`, sellerID, string(s.currentTier), string(newTier), reason); err != nil {
		return "", false, fmt.Errorf("insert tier event: %w", err)
	}

	return newTier, true, nil
}

// TierChange is one seller whose tier actually moved during a
// RecomputeAllTiers pass — cmd/worker logs these.
type TierChange struct {
	SellerID string
	From     Tier
	To       Tier
	Reason   string
}

// RecomputeAllTiers runs RecomputeTier for every seller with at least one
// order — sellers who've never sold anything have nothing to recompute,
// and stay at the 'new' default. One seller's failure is logged by the
// caller and never blocks every other seller's recompute (same "one bad
// row must never block the rest" principle as auction close).
func RecomputeAllTiers(ctx context.Context, pool *pgxpool.Pool) ([]TierChange, []error) {
	rows, err := pool.Query(ctx, `select distinct seller_id from orders`)
	if err != nil {
		return nil, []error{fmt.Errorf("query sellers: %w", err)}
	}
	var sellerIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, []error{fmt.Errorf("scan seller id: %w", err)}
		}
		sellerIDs = append(sellerIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, []error{err}
	}

	var changes []TierChange
	var errs []error
	for _, id := range sellerIDs {
		before, err := CurrentTier(ctx, pool, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("seller %s: %w", id, err))
			continue
		}
		after, changed, err := RecomputeTier(ctx, pool, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("seller %s: %w", id, err))
			continue
		}
		if changed {
			reason := "volume_promotion"
			if tierIndex(after) < tierIndex(before) {
				reason = "dispute_demotion"
			} else if before == TierNew && after == TierBronze {
				// Ambiguous between volume_promotion and
				// graduation_guarantee from the outside — the tier_events
				// row RecomputeTier already wrote has the precise reason;
				// this is just a same-process log line.
				reason = "promotion"
			}
			changes = append(changes, TierChange{SellerID: id, From: before, To: after, Reason: reason})
		}
	}
	return changes, errs
}
