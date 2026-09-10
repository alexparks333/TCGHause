package auction

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/pkg/fees"
	"auctionhous-tcg/api/pkg/money"
)

// noTax is a stand-in until Stripe Tax is wired up — a separate,
// substantial integration (Tax Registrations, the Tax Calculation API) out
// of scope for this pass. No listing currently collects sales tax, so
// every order's tax_cents is 0 for now. Design doc v2 §8.2's hard rule
// (charged tax must exactly equal Stripe Tax's figure) trivially holds in
// the meantime, since both sides of that comparison are 0 — this is a
// placeholder to swap for a real Stripe Tax call, not a permanent policy
// decision to never collect tax.
func noTax(_ money.Cents, _ fees.Address) (money.Cents, error) {
	return 0, nil
}

// quoteForListing recomputes a fresh fees.Quote from the seller's
// currently-stored tier and the given subtotal/shipping — never trusted
// from the client, same "always re-check server-side" principle as
// everywhere else real money moves in this codebase (CLAUDE.md §5.3).
// Shared by checkout.go (the initial quote, at authorization time) and
// buynow.go (re-verified fresh again at capture time), so both always
// price an order identically. shippingCents is the caller's
// responsibility to compute via shipping.ChargedCents against the
// order's actually-resolved preset — this function just plugs it into
// the fee math, it doesn't know anything about presets itself.
//
// Returns the percentage actually used alongside the quote/tier —
// seller.PctForSeller (not PctForTier) is what resolves a Hous Trust
// seller's individually negotiated rate, so callers must use the returned
// pct for anything downstream (e.g. order.CreateInput.TierPct) rather than
// re-deriving it from tier alone, or a Hous Trust order would get priced
// against a shared constant nobody actually agreed to.
func quoteForListing(ctx context.Context, pool *pgxpool.Pool, sellerID string, subtotalCents, shippingCents int64) (fees.Quote, seller.Tier, float64, error) {
	tier, err := seller.CurrentTier(ctx, pool, sellerID)
	if err != nil {
		return fees.Quote{}, "", 0, err
	}
	pct, err := seller.PctForSeller(ctx, pool, sellerID, tier)
	if err != nil {
		return fees.Quote{}, "", 0, err
	}
	q, err := fees.ComputeQuote(money.Cents(subtotalCents), money.Cents(shippingCents), pct, noTax, fees.Address{})
	if err != nil {
		return fees.Quote{}, "", 0, err
	}
	return q, tier, pct, nil
}
