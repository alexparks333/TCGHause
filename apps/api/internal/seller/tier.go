package seller

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Tier is a seller's trust standing (design doc v2 §3.1) — the input to
// pkg/fees' commission rate (via PctForSeller below) and to release timing
// (internal/order.MarkDelivered's Haus Trust instant-release branch).
type Tier string

const (
	TierNew       Tier = "new"
	TierBronze    Tier = "bronze"
	TierSilver    Tier = "silver"
	TierGold      Tier = "gold"
	TierPlatinum  Tier = "platinum"
	TierHausTrust Tier = "haus_trust"
)

// tierPct is the fixed commission ladder for every tier EXCEPT Haus
// Trust — Platinum is what Haus Trust used to be (500-order threshold,
// 5.50% rate) before Haus Trust became its own tier above it. Haus Trust
// deliberately has no entry here: its rate isn't fixed, it's negotiated
// per seller at application approval (see haustrust.go) depending on what
// they sell — pkg/fees.ComputeQuote's tierPct argument comes from
// PctForSeller below, never this map directly, specifically so a Haus
// Trust lookup can never silently fall back to a wrong fixed number.
var tierPct = map[Tier]float64{
	TierNew:      0.0700,
	TierBronze:   0.0650,
	TierSilver:   0.0625,
	TierGold:     0.0600,
	TierPlatinum: 0.0550,
}

// hausTrustFallbackPct is used only if a Haus Trust seller somehow has no
// custom_pct on file (should never happen — DecideHausTrustApplication
// requires setting one on approval, it's the only way into this tier) —
// a missing rate must never silently charge 0%. Deliberately better than
// Platinum's 5.50%, since Haus Trust is supposed to read as strictly the
// best tier even in this shouldn't-happen fallback case.
const hausTrustFallbackPct = 0.0500

// PctForTier returns the FIXED commission percentage for t. Never call
// this for TierHausTrust — its rate isn't fixed, see PctForSeller. Kept
// for the fixed tiers because most callers (fee display, tier-ladder docs/
// public pages) only ever need to know "what does this tier pay," not a
// specific seller's negotiated rate.
func PctForTier(t Tier) float64 {
	return tierPct[t]
}

// PctForSeller returns the commission percentage actually charged to
// sellerID given their current tier — every tier except Haus Trust uses
// the shared PctForTier ladder; Haus Trust's rate is individually
// negotiated per seller (depending on what they sell) at application
// approval, so it's read from users.haus_trust_custom_pct instead. This is
// the function every checkout/quote path must call — never PctForTier
// directly — precisely so a Haus Trust seller's actual negotiated rate is
// what gets charged, not a shared constant nobody agreed to.
func PctForSeller(ctx context.Context, pool *pgxpool.Pool, sellerID string, tier Tier) (float64, error) {
	if tier != TierHausTrust {
		return tierPct[tier], nil
	}
	var customPct *float64
	if err := pool.QueryRow(ctx, `select haus_trust_custom_pct from users where id = $1`, sellerID).Scan(&customPct); err != nil {
		return 0, fmt.Errorf("read haus trust custom pct: %w", err)
	}
	if customPct == nil {
		return hausTrustFallbackPct, nil
	}
	return *customPct, nil
}

// MyTierStatus is everything a seller's own account/settings page needs to
// show "here's your standing and what it takes to move up" — real numbers,
// not the ladder's constants alone, so a seller can see their own distance
// from the next rung.
type MyTierStatus struct {
	Tier             Tier    `json:"tier"`
	TierPct          float64 `json:"tierPct"`
	CumulativeOrders int     `json:"cumulativeOrders"`
	DisputeRate90d   float64 `json:"disputeRate90d"`
	ReviewCount      int     `json:"reviewCount"`
	AverageRating    float64 `json:"averageRating"`
}

// GetMyTierStatus reads sellerID's current standing straight off users —
// the same columns RecomputeTier keeps current, not a re-derivation.
func GetMyTierStatus(ctx context.Context, pool *pgxpool.Pool, sellerID string) (*MyTierStatus, error) {
	var s MyTierStatus
	var tier string
	if err := pool.QueryRow(ctx, `
		select tier, cumulative_orders, dispute_rate_90d, review_count, average_rating
		from users where id = $1
	`, sellerID).Scan(&tier, &s.CumulativeOrders, &s.DisputeRate90d, &s.ReviewCount, &s.AverageRating); err != nil {
		return nil, fmt.Errorf("read seller tier status: %w", err)
	}
	s.Tier = Tier(tier)
	pct, err := PctForSeller(ctx, pool, sellerID, s.Tier)
	if err != nil {
		return nil, err
	}
	s.TierPct = pct
	return &s, nil
}

// CurrentTier reads sellerID's stored tier straight from users.tier
// (migration 0022, default 'new'). Deliberately just the read side —
// promotion/demotion itself lives in promotion.go's RecomputeTier (the
// daily worker) and haustrust.go's application flow; this function just
// reads whatever's actually stored right now.
func CurrentTier(ctx context.Context, pool *pgxpool.Pool, sellerID string) (Tier, error) {
	var t string
	if err := pool.QueryRow(ctx, `select tier from users where id = $1`, sellerID).Scan(&t); err != nil {
		return "", fmt.Errorf("read seller tier: %w", err)
	}
	return Tier(t), nil
}

// StripeAccountID returns sellerID's Connect account id, or "" if they've
// never started onboarding — checked at both checkout-intent creation and
// again fresh at capture time (never cached across that gap), since a
// direct charge's PaymentIntent only exists on whichever connected account
// it was created on.
func StripeAccountID(ctx context.Context, pool *pgxpool.Pool, sellerID string) (string, error) {
	var id *string
	if err := pool.QueryRow(ctx, `select stripe_account_id from users where id = $1`, sellerID).Scan(&id); err != nil {
		return "", fmt.Errorf("read seller stripe account id: %w", err)
	}
	if id == nil {
		return "", nil
	}
	return *id, nil
}
