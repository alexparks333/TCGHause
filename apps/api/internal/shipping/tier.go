package shipping

// Tier is the value-driven minimum shipping service level (product
// decision, docs/Shipping_Research.md's synthesis section) — never chosen
// freely below what an order's final price requires, only chosen upward at
// listing time. Named after the packaging preset a seller picks when
// listing (see internal/listing's ShippingTier field, same three string
// values): "standard" is bubble-mailer-and-protective-guard shipping for
// the common case (cheapest available rate, no tracking mandated),
// "tracked" once a sale crosses $100 so a carrier scan actually exists to
// confirm delivery before escrow's claim-window timer starts, "signature"
// once a sale crosses $500 so an objective, carrier-verified handoff exists
// before release — mirrors eBay's own signature-confirmation line
// (CLAUDE.md §6.5), tightened for this marketplace's lower average order
// value.
//
// A fourth policy — mandatory buyer/seller authentication above $150 — was
// named by the business alongside these thresholds but is an explicit,
// deliberate non-goal here ("I will figure out a way to do this properly"):
// no code path exists for it yet. Don't infer one from this package.
type Tier string

const (
	TierStandard  Tier = "standard"
	TierTracked   Tier = "tracked"
	TierSignature Tier = "signature"
)

func (t Tier) Valid() bool {
	switch t {
	case TierStandard, TierTracked, TierSignature:
		return true
	}
	return false
}

// Thresholds, in cents. TrackingRequiredCents ($100) and
// SignatureRequiredCents ($500) are the two product-decided cutoffs;
// there's no separate authentication threshold constant here on purpose
// (see the package doc above).
const (
	TrackingRequiredCents  = 10000
	SignatureRequiredCents = 50000
)

// RequiredTier derives the minimum tier an order's final charged amount
// mandates — the floor that Max combines with a seller's listing-time
// preset.
func RequiredTier(amountCents int64) Tier {
	switch {
	case amountCents >= SignatureRequiredCents:
		return TierSignature
	case amountCents >= TrackingRequiredCents:
		return TierTracked
	default:
		return TierStandard
	}
}

var tierRank = map[Tier]int{TierStandard: 0, TierTracked: 1, TierSignature: 2}

// Max returns whichever of a, b ranks stricter — how a seller's chosen
// listing-time preset and RequiredTier's price-derived floor combine at
// order-creation time (order.CreateFromWin). A low-starting-bid auction
// that closes above $500 must ship signature-tier even if the seller picked
// "standard" back when the listing went up; a seller who opts into a
// stricter tier than the price requires is always honored, never downgraded.
func Max(a, b Tier) Tier {
	if tierRank[a] >= tierRank[b] {
		return a
	}
	return b
}
