package fees

import (
	"testing"

	"auctionhous-tcg/api/pkg/money"
)

// zeroTax is a stub TaxFunc for fixtures with no sales tax.
func zeroTax(_ money.Cents, _ Address) (money.Cents, error) {
	return 0, nil
}

// flatTax returns a stub TaxFunc that applies a fixed percentage rate,
// standing in for a real Stripe Tax call in tests.
func flatTax(pct float64) TaxFunc {
	return func(amount money.Cents, _ Address) (money.Cents, error) {
		return roundHalfUp(float64(amount) * pct), nil
	}
}

// TestGoldTierFixtures asserts every row of design doc v2 §2.5: Gold tier
// (6.00%), no shipping, no tax.
//
// Two rows ($50 and $250) deviate by exactly 1 cent from the doc's own
// published table. Both hit an exact floating-point tie in
// `discount = Math.round(saving * BUYER_SHARE)` — 135*0.7 = 94.5 and
// 555*0.7 = 388.5 precisely, in IEEE-754 double precision (verified: not a
// rounding-error artifact, the products land exactly on .5). Standard
// round-half-up (`Math.round` in JS, `math.Round` in Go — both round ties
// away from zero) resolves these to 95/389, giving bank prices $49.05 and
// $246.11 — not the doc's published $49.06/$246.12. This implementation
// uses round-half-up consistently, because that's the only rounding rule
// that also reproduces the doc's own $5/$25/etc. rows below (their
// intermediate `cardProcessingCost` computations hit ties too — 14.5 and
// 72.5 — and those unambiguously need to round UP to match the doc's
// figures). Rounding this pair down instead would fix these two cells but
// break that consistency and the shared rounding chokepoint the design doc
// itself calls for (§2.2: "round half-up... at the final step only"). Net
// effect: a genuine 1-cent inconsistency in the design doc's published
// table, not a bug here — flagged rather than silently chased.
func TestGoldTierFixtures(t *testing.T) {
	const goldPct = 0.06

	cases := []struct {
		list       money.Cents
		fee        money.Cents
		net        money.Cents
		cardPrice  money.Cents
		bankPrice  money.Cents
		buyerSaves money.Cents
	}{
		{200, 42, 158, 200, 176, 24},
		{500, 60, 440, 500, 471, 29},
		{1000, 90, 910, 1000, 964, 36},
		{2500, 180, 2320, 2500, 2442, 58},
		{5000, 330, 4670, 5000, 4905, 95}, // doc says 4906/94 — see comment above
		{10000, 630, 9370, 10000, 9832, 168},
		{25000, 1530, 23470, 25000, 24611, 389}, // doc says 24612/388 — see comment above
		{50000, 3030, 46970, 50000, 49244, 756},
	}

	for _, c := range cases {
		fee := SellerFee(c.list, 0, goldPct)
		net := SellerNet(c.list, 0, goldPct)
		if fee != c.fee {
			t.Errorf("list %v: SellerFee = %v, want %v", c.list, fee, c.fee)
		}
		if net != c.net {
			t.Errorf("list %v: SellerNet = %v, want %v", c.list, net, c.net)
		}

		q, err := ComputeQuote(c.list, 0, goldPct, zeroTax, Address{})
		if err != nil {
			t.Fatalf("list %v: ComputeQuote error: %v", c.list, err)
		}
		if q.CardTotal != c.cardPrice {
			t.Errorf("list %v: CardTotal = %v, want %v", c.list, q.CardTotal, c.cardPrice)
		}
		if q.BankTotal != c.bankPrice {
			t.Errorf("list %v: BankTotal = %v, want %v", c.list, q.BankTotal, c.bankPrice)
		}
		if q.RealizedSaving != c.buyerSaves {
			t.Errorf("list %v: RealizedSaving = %v, want %v", c.list, q.RealizedSaving, c.buyerSaves)
		}
		if q.SellerFee != c.fee || q.SellerNet != c.net {
			t.Errorf("list %v: Quote.SellerFee/Net = %v/%v, want %v/%v", c.list, q.SellerFee, q.SellerNet, c.fee, c.net)
		}
	}
}

// TestTierLadderFixture asserts design doc v2 §2.6 exactly: a $100 item +
// $5 shipping + 8.25% tax, across all five tiers. Card/bank totals are the
// same regardless of tier; only the seller's fee/net changes.
func TestTierLadderFixture(t *testing.T) {
	const subtotal = 10000
	const shipping = 500
	tax := flatTax(0.0825)

	const wantCardTotal = 11366
	const wantBankTotal = 11163
	const wantRealizedSaving = 203

	cases := []struct {
		name string
		pct  float64
		fee  money.Cents
		net  money.Cents
	}{
		{"New", 0.0700, 765, 9735},
		{"Bronze", 0.0650, 713, 9787},
		{"Silver", 0.0625, 686, 9814},
		{"Gold", 0.0600, 660, 9840},
		{"HousTrust", 0.0550, 608, 9892},
	}

	for _, c := range cases {
		q, err := ComputeQuote(subtotal, shipping, c.pct, tax, Address{})
		if err != nil {
			t.Fatalf("%s: ComputeQuote error: %v", c.name, err)
		}
		if q.CardTotal != wantCardTotal {
			t.Errorf("%s: CardTotal = %v, want %v", c.name, q.CardTotal, wantCardTotal)
		}
		if q.BankTotal != wantBankTotal {
			t.Errorf("%s: BankTotal = %v, want %v", c.name, q.BankTotal, wantBankTotal)
		}
		if q.RealizedSaving != wantRealizedSaving {
			t.Errorf("%s: RealizedSaving = %v, want %v", c.name, q.RealizedSaving, wantRealizedSaving)
		}
		if q.SellerFee != c.fee {
			t.Errorf("%s: SellerFee = %v, want %v", c.name, q.SellerFee, c.fee)
		}
		if q.SellerNet != c.net {
			t.Errorf("%s: SellerNet = %v, want %v", c.name, q.SellerNet, c.net)
		}
	}
}

// TestInvariant_SellerNetIdenticalBothRails is §2.4 invariant #1: a
// seller's net must never depend on which rail the buyer picked, or on tax
// rate/address — it's a pure function of list price, shipping, and tier.
func TestInvariant_SellerNetIdenticalBothRails(t *testing.T) {
	taxFuncs := []TaxFunc{zeroTax, flatTax(0.0825), flatTax(0.05)}
	for _, list := range []money.Cents{199, 2000, 15099, 75000} {
		for _, shipping := range []money.Cents{0, 500, 1500} {
			for _, pct := range []float64{0.07, 0.065, 0.0625, 0.06, 0.055} {
				want := SellerNet(list, shipping, pct)
				for _, tax := range taxFuncs {
					q, err := ComputeQuote(list, shipping, pct, tax, Address{})
					if err != nil {
						t.Fatalf("ComputeQuote error: %v", err)
					}
					if q.SellerNet != want {
						t.Errorf("list=%v shipping=%v pct=%v: SellerNet = %v, want %v (rail-independent)",
							list, shipping, pct, q.SellerNet, want)
					}
				}
			}
		}
	}
}

// TestInvariant_ChargedTaxNeverModified is §2.4 invariant #2: the tax
// charged must always equal exactly what the TaxFunc (Stripe Tax, in
// production) returned — never padded, rounded, or otherwise touched. Uses
// a deliberately odd, non-round TaxFunc to catch any future refactor that
// starts adjusting the tax line.
func TestInvariant_ChargedTaxNeverModified(t *testing.T) {
	oddTax := func(amount money.Cents, _ Address) (money.Cents, error) {
		return amount%97 + 13, nil // deliberately odd, non-percentage shape
	}

	for _, list := range []money.Cents{199, 4321, 98765} {
		for _, shipping := range []money.Cents{0, 799} {
			q, err := ComputeQuote(list, shipping, 0.06, oddTax, Address{})
			if err != nil {
				t.Fatalf("ComputeQuote error: %v", err)
			}
			wantCardTax, _ := oddTax(list+shipping, Address{})
			if q.CardTax != wantCardTax {
				t.Errorf("list=%v shipping=%v: CardTax = %v, want %v (passed through unmodified)",
					list, shipping, q.CardTax, wantCardTax)
			}
			wantBankTax, _ := oddTax(q.BankGoods+shipping, Address{})
			if q.BankTax != wantBankTax {
				t.Errorf("list=%v shipping=%v: BankTax = %v, want %v (passed through unmodified)",
					list, shipping, q.BankTax, wantBankTax)
			}
		}
	}
}

// TestInvariant_BankMarginAtLeastCardMargin is §2.4 invariant #3: since
// BuyerShare < 1, the platform keeps a strictly larger cut of the
// processing saving than it gives away, so bank-rail margin must never be
// worse than card-rail margin. Platform margin per rail = SellerFee minus
// the rail's processing cost, minus (bank rail only) the Discount handed to
// the buyer — see docs/PercentageModel.md §3 worked examples.
func TestInvariant_BankMarginAtLeastCardMargin(t *testing.T) {
	for _, list := range []money.Cents{200, 1500, 10000, 50000, 150000} {
		for _, shipping := range []money.Cents{0, 500, 2000} {
			for _, pct := range []float64{0.07, 0.065, 0.0625, 0.06, 0.055} {
				for _, tax := range []TaxFunc{zeroTax, flatTax(0.0825)} {
					q, err := ComputeQuote(list, shipping, pct, tax, Address{})
					if err != nil {
						t.Fatalf("ComputeQuote error: %v", err)
					}
					marginCard := q.SellerFee - q.CardCost
					marginBank := q.SellerFee - q.BankCost - q.Discount
					if marginBank < marginCard {
						t.Errorf("list=%v shipping=%v pct=%v: marginBank %v < marginCard %v",
							list, shipping, pct, marginBank, marginCard)
					}
				}
			}
		}
	}
}

// TestInvariant_BankTotalLessThanCardTotal is §2.4 invariant #4: whenever
// there's a positive processing-cost saving from routing to ACH, the bank
// total must be strictly less than the card total.
func TestInvariant_BankTotalLessThanCardTotal(t *testing.T) {
	for _, list := range []money.Cents{200, 1500, 10000, 50000, 150000} {
		for _, shipping := range []money.Cents{0, 500, 2000} {
			for _, tax := range []TaxFunc{zeroTax, flatTax(0.0825)} {
				q, err := ComputeQuote(list, shipping, 0.06, tax, Address{})
				if err != nil {
					t.Fatalf("ComputeQuote error: %v", err)
				}
				achRef := AchProcessingCost(q.CardTotal)
				if q.CardCost > achRef {
					if q.BankTotal >= q.CardTotal {
						t.Errorf("list=%v shipping=%v: BankTotal %v >= CardTotal %v despite positive processing saving",
							list, shipping, q.BankTotal, q.CardTotal)
					}
				}
			}
		}
	}
}
