// Package metrics computes the internal reporting snapshot design doc v2
// §11 calls for — every number here is a real aggregate over
// orders/claims/payouts/tier_events, never a placeholder. Instrumented from
// day one per the doc's own framing, even though there's no real traffic
// yet to make these numbers meaningful — the point is that the plumbing is
// correct before it matters, not after.
package metrics

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RailMix is order count and total GMV for one payment rail.
type RailMix struct {
	Rail       string `json:"rail"`
	OrderCount int64  `json:"orderCount"`
	GMVCents   int64  `json:"gmvCents"`
}

// TierGMV is completed-order count and GMV for one seller tier — design
// doc v2 §11's "tier distribution of GMV," the number that tells you
// whether tier thresholds are actually calibrated right (if most GMV sits
// in New, the thresholds are wrong, per design doc v2 §3.2).
type TierGMV struct {
	Tier       string `json:"tier"`
	OrderCount int64  `json:"orderCount"`
	GMVCents   int64  `json:"gmvCents"`
}

// MarginByTierRail is realized platform margin — seller_fee_cents minus
// processing_cost_cents minus discount_cents (0 on the card rail) — summed
// per tier+rail combination (design doc v2 §11).
type MarginByTierRail struct {
	Tier        string `json:"tier"`
	Rail        string `json:"rail"`
	OrderCount  int64  `json:"orderCount"`
	MarginCents int64  `json:"marginCents"`
}

// Snapshot is the full metrics page in one payload.
type Snapshot struct {
	TotalOrders int64 `json:"totalOrders"`
	// AchMixPct is design doc v2 §11's single most important number —
	// "card-only economics are marginal."
	AchMixPct float64 `json:"achMixPct"`
	// OrdersPerActiveSellerLast30d — the most sensitive input to Connect
	// cost per order (design doc v2 §7.4: ~2/3 of Connect cost is the flat
	// $2/seller/month, so low-volume sellers cost more than they generate).
	OrdersPerActiveSellerLast30d float64            `json:"ordersPerActiveSellerLast30d"`
	RailMix                      []RailMix          `json:"railMix"`
	TierGMV                      []TierGMV          `json:"tierGmv"`
	MarginByTierRail             []MarginByTierRail `json:"marginByTierRail"`
	// DisputeRateByTier — validates the risk-pricing premise behind the
	// tier ladder (design doc v2 §3, §11): New should show a materially
	// higher dispute rate than Haus Trust, or the pricing isn't doing its job.
	DisputeRateByTier []DisputeRateByTier `json:"disputeRateByTier"`
	// AchReturnRatePct — design doc v2 §4.1's trigger: above 0.5%,
	// evaluate switching the discount rail to Instant Bank Payments.
	AchReturnRatePct float64 `json:"achReturnRatePct"`
	// AvgHoursPurchaseToPayout — "biggest source of seller complaints"
	// per design doc v2 §11 — only counts orders that have actually been
	// paid out, via payout_orders -> payouts.paid_at.
	AvgHoursPurchaseToPayout *float64 `json:"avgHoursPurchaseToPayout,omitempty"`
}

type DisputeRateByTier struct {
	Tier       string  `json:"tier"`
	OrderCount int64   `json:"orderCount"`
	ClaimCount int64   `json:"claimCount"`
	RatePct    float64 `json:"ratePct"`
}

// Compute pulls a fresh snapshot straight from the database — never
// cached, since this is an internal reporting tool where staleness would
// just be confusing, not a performance concern at this scale.
func Compute(ctx context.Context, pool *pgxpool.Pool) (Snapshot, error) {
	var s Snapshot

	if err := pool.QueryRow(ctx, `select count(*) from orders`).Scan(&s.TotalOrders); err != nil {
		return s, fmt.Errorf("count orders: %w", err)
	}

	rows, err := pool.Query(ctx, `
		select coalesce(rail, 'unknown'), count(*), coalesce(sum(charged_cents), 0)
		from orders group by rail
	`)
	if err != nil {
		return s, fmt.Errorf("query rail mix: %w", err)
	}
	var achOrders, cardOrders int64
	for rows.Next() {
		var m RailMix
		if err := rows.Scan(&m.Rail, &m.OrderCount, &m.GMVCents); err != nil {
			rows.Close()
			return s, fmt.Errorf("scan rail mix: %w", err)
		}
		s.RailMix = append(s.RailMix, m)
		if m.Rail == "ach" {
			achOrders = m.OrderCount
		} else if m.Rail == "card" {
			cardOrders = m.OrderCount
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}
	if total := achOrders + cardOrders; total > 0 {
		s.AchMixPct = 100 * float64(achOrders) / float64(total)
	}

	rows, err = pool.Query(ctx, `
		select tier_at_sale, count(*), coalesce(sum(charged_cents), 0)
		from orders group by tier_at_sale
	`)
	if err != nil {
		return s, fmt.Errorf("query tier gmv: %w", err)
	}
	for rows.Next() {
		var t TierGMV
		if err := rows.Scan(&t.Tier, &t.OrderCount, &t.GMVCents); err != nil {
			rows.Close()
			return s, fmt.Errorf("scan tier gmv: %w", err)
		}
		s.TierGMV = append(s.TierGMV, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}

	rows, err = pool.Query(ctx, `
		select tier_at_sale, coalesce(rail, 'unknown'), count(*),
			coalesce(sum(seller_fee_cents - processing_cost_cents - discount_cents), 0)
		from orders group by tier_at_sale, rail
	`)
	if err != nil {
		return s, fmt.Errorf("query margin: %w", err)
	}
	for rows.Next() {
		var m MarginByTierRail
		if err := rows.Scan(&m.Tier, &m.Rail, &m.OrderCount, &m.MarginCents); err != nil {
			rows.Close()
			return s, fmt.Errorf("scan margin: %w", err)
		}
		s.MarginByTierRail = append(s.MarginByTierRail, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}

	rows, err = pool.Query(ctx, `
		select o.tier_at_sale, count(distinct o.id), count(distinct c.id)
		from orders o
		left join claims c on c.order_id = o.id
		group by o.tier_at_sale
	`)
	if err != nil {
		return s, fmt.Errorf("query dispute rate by tier: %w", err)
	}
	for rows.Next() {
		var d DisputeRateByTier
		if err := rows.Scan(&d.Tier, &d.OrderCount, &d.ClaimCount); err != nil {
			rows.Close()
			return s, fmt.Errorf("scan dispute rate by tier: %w", err)
		}
		if d.OrderCount > 0 {
			d.RatePct = 100 * float64(d.ClaimCount) / float64(d.OrderCount)
		}
		s.DisputeRateByTier = append(s.DisputeRateByTier, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}

	// ACH return rate: an ACH order that ended up cancelled or refunded
	// while it was still payment_pending or shortly after (a real return
	// would show as charge.failed -> cancelled via internal/webhook) —
	// approximated here as "ach orders that ended cancelled," since
	// there's no dedicated return-event table.
	var achCancelled int64
	if err := pool.QueryRow(ctx, `
		select count(*) from orders where rail = 'ach' and state = 'cancelled'
	`).Scan(&achCancelled); err != nil {
		return s, fmt.Errorf("count ach returns: %w", err)
	}
	if achOrders > 0 {
		s.AchReturnRatePct = 100 * float64(achCancelled) / float64(achOrders)
	}

	if achOrders+cardOrders > 0 {
		var activeSellers, ordersLast30d int64
		if err := pool.QueryRow(ctx, `
			select count(distinct seller_id), count(*)
			from orders where created_at > now() - interval '30 days'
		`).Scan(&activeSellers, &ordersLast30d); err != nil {
			return s, fmt.Errorf("query orders per active seller: %w", err)
		}
		if activeSellers > 0 {
			s.OrdersPerActiveSellerLast30d = float64(ordersLast30d) / float64(activeSellers)
		}
	}

	var avgHours *float64
	if err := pool.QueryRow(ctx, `
		select avg(extract(epoch from (p.paid_at - o.created_at)) / 3600.0)
		from orders o
		join payout_orders po on po.order_id = o.id
		join payouts p on p.id = po.payout_id
		where p.paid_at is not null
	`).Scan(&avgHours); err != nil {
		return s, fmt.Errorf("query avg purchase-to-payout: %w", err)
	}
	s.AvgHoursPurchaseToPayout = avgHours

	return s, nil
}
