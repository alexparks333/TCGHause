package seller

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Tier is a seller's trust standing (design doc v2 §3.1) — the input to
// pkg/fees' commission rate, and eventually (Phase 7 — not built yet) to
// release timing (internal/payout) and listing caps.
type Tier string

const (
	TierNew       Tier = "new"
	TierBronze    Tier = "bronze"
	TierSilver    Tier = "silver"
	TierGold      Tier = "gold"
	TierHausTrust Tier = "haus_trust"
)

// tierPct is design doc v2 §3.1's exact commission ladder — the constant
// map pkg/fees.ComputeQuote's tierPct argument comes from.
var tierPct = map[Tier]float64{
	TierNew:       0.0700,
	TierBronze:    0.0650,
	TierSilver:    0.0625,
	TierGold:      0.0600,
	TierHausTrust: 0.0550,
}

// PctForTier returns the commission percentage for t.
func PctForTier(t Tier) float64 {
	return tierPct[t]
}

// CurrentTier reads sellerID's stored tier straight from users.tier
// (migration 0022, default 'new'). This is deliberately just the read
// side — promotion/demotion (cumulative order counts, dispute-rate gates,
// the graduation guarantee, the daily worker recompute — design doc v2
// §3.2-§3.6) is Phase 7 scope, not built yet, so every seller reads back
// 'new' until then. Whether that's the right launch behavior is an
// explicitly open product decision (design doc v2 §3.7) — not decided
// here; this function just reads whatever's actually stored.
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
