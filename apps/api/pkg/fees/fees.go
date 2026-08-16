// Package fees implements the pricing model from design doc v2 §2: the
// tiered seller commission, the card-vs-bank buyer pricing, and the
// order-of-operations that keeps tax correct on both rails. It is a pure,
// dependency-free leaf package — no DB, no HTTP, no Stripe SDK import — so
// it can be unit-tested directly against the design doc's own fixture
// tables (see fees_test.go and docs/PercentageModel.md).
//
// This package never looks up a seller's tier itself: internal/seller owns
// the tier->percentage mapping and calls into this package, never the
// reverse, so pkg/fees stays a leaf dependency.
package fees

import (
	"math"

	"auctionhous-tcg/api/pkg/money"
)

// Constants from design doc v2 §2.1. FeeFixedCents applies to every order,
// on both rails, at every tier — no minimum-order exemption, see
// docs/PercentageModel.md §1 for why a threshold would be gameable.
const (
	FeeFixedCents  = money.Cents(30)
	CardPct        = 0.029
	CardFixedCents = money.Cents(30)
	AchPct         = 0.008
	AchCapCents    = money.Cents(500)
	BuyerShare     = 0.70
)

// Address is the minimal buyer-location shape a TaxFunc needs. Kept local
// to this package, rather than importing internal/address, so pkg/fees has
// zero dependency on the rest of the app.
type Address struct {
	Line1, City, State, PostalCode, Country string
}

// TaxFunc computes sales tax owed on a taxable amount for a buyer's
// address — in production, a thin wrapper around Stripe Tax. Injected so
// this package never makes an HTTP call itself and stays a pure,
// unit-testable leaf (design doc v2 §8 requires using Stripe Tax, never a
// hand-rolled rate table — that lives in the caller, not here).
type TaxFunc func(amount money.Cents, buyerAddress Address) (money.Cents, error)

// roundHalfUp is the single rounding chokepoint in this package. Design doc
// v2 §2.2 requires rounding half-up at the final step only, nowhere else —
// every other function below does its arithmetic in float64 and rounds
// exactly once, right before returning.
func roundHalfUp(f float64) money.Cents {
	return money.Cents(math.Round(f))
}

// FeeBase is item price + shipping. Never sales tax — design doc v2 §2.1:
// shipping is money the seller receives, so feeing it is fair; tax is never
// ours, so we never fee it. See docs/PercentageModel.md §1.
func FeeBase(list, shipping money.Cents) money.Cents {
	return list + shipping
}

// SellerFee is what a seller pays on an order: tierPct of the fee base,
// plus the flat $0.30 charged on every order (design doc v2 §2.1/§2.2).
func SellerFee(list, shipping money.Cents, tierPct float64) money.Cents {
	base := FeeBase(list, shipping)
	return roundHalfUp(float64(base)*tierPct) + FeeFixedCents
}

// SellerNet is what's left for the seller after SellerFee. Always computed
// from the original list price and shipping — never from a buyer's
// discounted bank-rail price — so a seller's net never depends on which
// rail the buyer chose to pay with (design doc v2 §2.3's explicit
// invariant, restated in §2.4 test invariant #1).
func SellerNet(list, shipping money.Cents, tierPct float64) money.Cents {
	return FeeBase(list, shipping) - SellerFee(list, shipping, tierPct)
}

// CardProcessingCost is Stripe's own processing cost for a card charge of
// the given amount — a pass-through cost to the platform, not a fee we set.
func CardProcessingCost(amountCharged money.Cents) money.Cents {
	return roundHalfUp(float64(amountCharged)*CardPct) + CardFixedCents
}

// AchProcessingCost is Stripe's own processing cost for an ACH Direct Debit
// charge of the given amount, capped at AchCapCents.
func AchProcessingCost(amountCharged money.Cents) money.Cents {
	cost := roundHalfUp(float64(amountCharged) * AchPct)
	if cost > AchCapCents {
		return AchCapCents
	}
	return cost
}

// Quote is the full card-vs-bank price breakdown for one order, computed
// once so the two prices can never drift apart (design doc v2 §2.3).
type Quote struct {
	Subtotal, Shipping money.Cents

	CardTax, CardTotal, CardCost money.Cents

	BankGoods, BankTax, BankTotal, BankCost money.Cents

	// Discount is what was subtracted from goods to produce BankGoods.
	// RealizedSaving is the buyer's actual total savings (CardTotal minus
	// BankTotal), which is larger than Discount because a lower goods
	// price also lowers tax — display RealizedSaving to the buyer, never
	// Discount alone (design doc v2 §2.3).
	Discount, RealizedSaving money.Cents

	// SellerFee/SellerNet are computed once, from Subtotal+Shipping, and
	// are identical regardless of which rail the buyer ultimately picks.
	SellerFee, SellerNet money.Cents
}

// ComputeQuote is the single call site for pricing an order — checkout and
// any future price-preview endpoint must both go through this, so card and
// bank prices can never be computed from different assumptions.
func ComputeQuote(subtotal, shipping money.Cents, tierPct float64, taxFor TaxFunc, buyerAddress Address) (Quote, error) {
	q := Quote{Subtotal: subtotal, Shipping: shipping}

	q.SellerFee = SellerFee(subtotal, shipping, tierPct)
	q.SellerNet = SellerNet(subtotal, shipping, tierPct)

	cardTax, err := taxFor(subtotal+shipping, buyerAddress)
	if err != nil {
		return Quote{}, err
	}
	q.CardTax = cardTax
	q.CardTotal = subtotal + shipping + cardTax
	q.CardCost = CardProcessingCost(q.CardTotal)

	// achRef is a reference-only figure: the bank total isn't known yet
	// (it depends on the discount, which depends on this figure), so this
	// uses CardTotal as a single-pass approximation. Design doc v2 §2.3 is
	// explicit that this must NOT be iterated to convergence — it errs a
	// cent or two in the buyer's favor, which is the intended behavior.
	achRef := AchProcessingCost(q.CardTotal)
	saving := q.CardCost - achRef
	q.Discount = roundHalfUp(float64(saving) * BuyerShare)

	q.BankGoods = subtotal - q.Discount
	bankTax, err := taxFor(q.BankGoods+shipping, buyerAddress)
	if err != nil {
		return Quote{}, err
	}
	q.BankTax = bankTax
	q.BankTotal = q.BankGoods + shipping + bankTax
	q.BankCost = AchProcessingCost(q.BankTotal)

	q.RealizedSaving = q.CardTotal - q.BankTotal

	return q, nil
}
