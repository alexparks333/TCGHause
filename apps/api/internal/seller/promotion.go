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
// relies on that. **No entry for TierHausTrust, deliberately** — Haus Trust
// is never reached by order volume alone, only through the manual
// application process (haustrust.go); see volumeTierOrder below for why
// that's actually enforced, not just a documentation note.
var tierThreshold = map[Tier]int{
	TierBronze:   15,
	TierSilver:   50,
	TierGold:     150,
	TierPlatinum: 500,
}

// tierOrder is the FULL ladder in ascending order, Haus Trust included —
// used to step exactly one tier at a time on demotion (design doc v2 §3.5
// is explicit: drop ONE tier, never straight to New regardless of how bad
// the dispute rate is) and to find "one tier below current" generically. A
// Haus Trust seller who gets demoted correctly drops to Platinum through
// this list, even though nothing in this file can ever promote a seller
// INTO Haus Trust — demotion and promotion are allowed to use different
// tier sets for exactly that reason.
var tierOrder = []Tier{TierNew, TierBronze, TierSilver, TierGold, TierPlatinum, TierHausTrust}

// volumeTierOrder is every tier tierForOrders is allowed to land on —
// everything EXCEPT Haus Trust. This is what actually enforces "Haus Trust
// is application-only," not just tierThreshold having no entry for it: if
// tierForOrders looped over the full tierOrder instead, TierHausTrust's
// missing map entry would default to a threshold of 0, and since every
// order count is >= 0, every seller would "qualify" for Haus Trust on the
// very first order. Using a separate, shorter slice here is the actual
// safety mechanism, not a cosmetic one.
var volumeTierOrder = []Tier{TierNew, TierBronze, TierSilver, TierGold, TierPlatinum}

func tierIndex(t Tier) int {
	for i, x := range tierOrder {
		if x == t {
			return i
		}
	}
	return 0
}

// tierForOrders is the highest tier a bare order count alone qualifies
// for, capped at Platinum — promotion (unlike demotion) is allowed to jump
// straight to the highest qualifying tier in one recompute, e.g. after the
// worker was down for a while, since design doc v2 doesn't require
// promotion to step one tier at a time the way demotion explicitly does.
// Can never return TierHausTrust — see volumeTierOrder's doc comment.
func tierForOrders(n int) Tier {
	t := TierNew
	for _, candidate := range volumeTierOrder {
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

// minReviewsForTier/minAverageRatingForTier are a deliberate reversal of
// this file's earlier "not gated on review count" stance — explicit product
// decision: a seller racking up sales while carrying a bad average rating
// must not sail through on volume alone. This is different from the
// count-gaming concern the earlier comment worried about (soliciting "leave
// me 5 stars" to hit a review quota) — the gate here is a quality floor on
// the reviews a seller already has, not a quota that rewards asking for
// more of them.
//
// Scaled per target tier, not flat, on purpose — the same "the bar gets
// harder to clear the higher you go" shape tierThreshold and §4.1's
// dispute-risk multipliers already use. No entry for TierNew, same reason
// tierThreshold has none: every seller starts there, and the zero-value
// (0 reviews, 0.0 average) is correctly never a blocker for staying put.
// A promotion that jumps straight to the highest qualifying tier in one
// pass (tierForOrders' own doc comment) must clear THAT tier's bar, not an
// earlier rung's — see gatesPass.
//
// TierHausTrust entries ARE present here even though gatesPass (the
// auto-promotion path) can never actually be called with target ==
// TierHausTrust (tierForOrders never returns it — see volumeTierOrder).
// They're the eligibility bar haustrust.go's ApplyForHausTrust checks
// instead — same numbers, same map, different caller, so the bar for
// "eligible to apply" and "would auto-promote if this were reachable by
// volume" can never quietly drift apart into two different numbers.
var minReviewsForTier = map[Tier]int{
	TierBronze:    5,
	TierSilver:    15,
	TierGold:      40,
	TierPlatinum:  100,
	TierHausTrust: 500,
}

var minAverageRatingForTier = map[Tier]float64{
	TierBronze:    4.0,
	TierSilver:    4.3,
	TierGold:      4.5,
	TierPlatinum:  4.5,
	TierHausTrust: 4.5,
}

// standing is one seller's computed inputs for a promotion/demotion
// decision — everything derived fresh from orders/users/claims/reviews on
// every recompute (CLAUDE.md §5.4: never cached-only, never hand-set).
type standing struct {
	currentTier        Tier
	accountCreatedAt   time.Time
	cumulativeOrders   int
	disputeRate90d     float64
	oldestOpenClaimAge *time.Duration
	lastDemotionAt     *time.Time
	reviewCount        int
	averageRating      float64
}

// gatesPass is design doc v2 §3.3's promotion gates, ALL required: dispute
// rate under 2% trailing 90 days, no unresolved claim older than 7 days,
// account age at least 14 days, and (added on top of the original design)
// at least target's minReviewsForTier reviews averaging at least
// target's minAverageRatingForTier — target being whichever tier this
// specific promotion attempt would move the seller to, so a seller jumping
// straight from New to Gold on order volume alone has to clear Gold's
// review bar, not Bronze's easier one. A seller with plenty of orders but a
// poor or too-thin review record fails this gate exactly the same way a
// high dispute rate does — one bad-standing signal is enough to hold a
// promotion, this isn't an "average across signals" score.
func gatesPass(s standing, target Tier) bool {
	if s.disputeRate90d >= promotionGateDisputeRate {
		return false
	}
	if s.oldestOpenClaimAge != nil && *s.oldestOpenClaimAge > 7*24*time.Hour {
		return false
	}
	if s.reviewCount < minReviewsForTier[target] {
		return false
	}
	if s.averageRating < minAverageRatingForTier[target] {
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

	// Figure out the candidate target tier and reason BEFORE checking gates
	// — gatesPass' review-quality bar is target-specific (higher tiers
	// demand more/better reviews), so which tier this promotion would land
	// on has to be known first, not decided only after gates already passed.
	target, reason := s.currentTier, ""

	// Graduation guarantee overrides the normal 15-order Bronze threshold
	// for a New seller who's hit 25 orders or 30 days since their account
	// was created, whichever comes first — gates below still apply
	// (design doc v2 §3.4), including the review-quality bar: hitting 30
	// days with a bad review record does not graduate a seller.
	if s.currentTier == TierNew && tierForOrders(s.cumulativeOrders) == TierNew {
		accountAge := time.Since(s.accountCreatedAt)
		if s.cumulativeOrders >= graduationOrderCount || accountAge >= graduationAge {
			target, reason = TierBronze, "graduation_guarantee"
		}
	}

	// Volume promotion can still override the graduation guarantee's target
	// if order count alone already qualifies for something higher (e.g. a
	// seller who raced past 25 orders before 30 days elapsed, but whose
	// order count already clears Silver) — same "jump straight to the
	// highest qualifying tier" behavior as before, just computed as a
	// candidate here instead of an immediate return.
	if qualifies := tierForOrders(s.cumulativeOrders); tierIndex(qualifies) > tierIndex(target) {
		target, reason = qualifies, "volume_promotion"
	}

	if target == s.currentTier {
		return s.currentTier, ""
	}
	if !gatesPass(s, target) {
		return s.currentTier, ""
	}
	return target, reason
}

// reviewStats returns sellerID's review count and average rating across
// all three rating axes (internal/feedback's own overallOf) blended
// together, not any one axis alone — queried directly here rather than
// importing internal/feedback, since this is a two-column aggregate, not
// any of that package's actual review-CRUD logic. Shared by loadStanding
// (the auto-promotion gate) and haustrust.go's ApplyForHausTrust (the
// application-eligibility check), so both read the exact same numbers —
// see minReviewsForTier's doc comment for why that matters.
// coalesce(..., 0) on the average matters only cosmetically (a zero-review
// seller's average is never actually read anywhere, since reviewCount
// already fails whatever gate is checking it on its own) but keeps the
// scan from erroring on a NULL avg() over zero rows.
func reviewStats(ctx context.Context, pool *pgxpool.Pool, sellerID string) (count int, average float64, err error) {
	if err := pool.QueryRow(ctx, `
		select count(*), coalesce(avg((condition_accuracy + shipping_speed + trustworthiness) / 3.0), 0)
		from seller_reviews where seller_id = $1
	`, sellerID).Scan(&count, &average); err != nil {
		return 0, 0, fmt.Errorf("read seller review stats: %w", err)
	}
	return count, average, nil
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

	// disputeRate90d = claims filed against this seller's orders in the
	// trailing 90 days, divided by this seller's own orders placed in that
	// same window (excluding cancelled/refunded, same exclusion as
	// cumulativeOrders above — an order that never really happened
	// shouldn't inflate the denominator any more than it should the
	// numerator). Zero orders in the window is "nothing to measure," not
	// "100% dispute rate" — treated as a clean 0 rather than a divide by
	// zero, since a seller who hasn't sold anything in 90 days can't be
	// penalized for a rate that has no denominator.
	var claims90d, orders90d int
	if err := pool.QueryRow(ctx, `
		select count(*) from claims c
		join orders o on o.id = c.order_id
		where o.seller_id = $1 and c.created_at > now() - interval '90 days'
	`, sellerID).Scan(&claims90d); err != nil {
		return s, fmt.Errorf("count seller claims (90d): %w", err)
	}
	if err := pool.QueryRow(ctx, `
		select count(*) from orders
		where seller_id = $1 and state not in ('cancelled', 'refunded')
			and created_at > now() - interval '90 days'
	`, sellerID).Scan(&orders90d); err != nil {
		return s, fmt.Errorf("count seller orders (90d): %w", err)
	}
	if orders90d > 0 {
		s.disputeRate90d = float64(claims90d) / float64(orders90d)
	}

	// oldestOpenClaimAge: the age of the longest-unresolved claim against
	// any of this seller's orders. "Unresolved" is resolved_at is null —
	// true from the moment a claim opens through negotiation, escalation,
	// and auto-adjudication/human-review, only becoming false once a real
	// decision (or a mutual agreement) actually lands, regardless of
	// whether it's later appealed (an appeal doesn't clear resolved_at,
	// since the original decision that resolved it already stands).
	var oldestOpenClaimCreatedAt *time.Time
	if err := pool.QueryRow(ctx, `
		select min(c.created_at) from claims c
		join orders o on o.id = c.order_id
		where o.seller_id = $1 and c.resolved_at is null
	`, sellerID).Scan(&oldestOpenClaimCreatedAt); err != nil {
		return s, fmt.Errorf("read oldest open claim: %w", err)
	}
	if oldestOpenClaimCreatedAt != nil {
		age := time.Since(*oldestOpenClaimCreatedAt)
		s.oldestOpenClaimAge = &age
	}

	reviewCount, averageRating, err := reviewStats(ctx, pool, sellerID)
	if err != nil {
		return s, err
	}
	s.reviewCount, s.averageRating = reviewCount, averageRating

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
// (cumulative_orders/dispute_rate_90d/review_count/average_rating) even
// when the tier itself doesn't change, since those are the audit trail a
// support agent reads to answer "why is this seller still New," not just
// promotion/demotion inputs.
// Returns the seller's tier after this call and whether it changed.
func RecomputeTier(ctx context.Context, pool *pgxpool.Pool, sellerID string) (Tier, bool, error) {
	s, err := loadStanding(ctx, pool, sellerID)
	if err != nil {
		return "", false, err
	}

	if _, err := pool.Exec(ctx, `
		update users set cumulative_orders = $1, dispute_rate_90d = $2, review_count = $3, average_rating = $4
		where id = $5
	`, s.cumulativeOrders, s.disputeRate90d, s.reviewCount, s.averageRating, sellerID); err != nil {
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

	// A seller demoted out of Haus Trust loses their negotiated rate —
	// it was granted for that tier specifically (haustrust.go's
	// application process), and letting it silently persist on a
	// now-Platinum seller would mean PctForSeller keeps charging a
	// Haus-Trust-only rate to someone no longer in that tier. If they're
	// re-approved for Haus Trust later, a fresh application grants a fresh
	// rate — never reuse a stale one.
	if s.currentTier == TierHausTrust && newTier != TierHausTrust {
		if _, err := pool.Exec(ctx, `update users set haus_trust_custom_pct = null where id = $1`, sellerID); err != nil {
			return "", false, fmt.Errorf("clear haus trust custom pct: %w", err)
		}
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
