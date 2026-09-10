package order

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/pkg/fees"
)

// State is one of the eleven order states from design doc v2 §5.1 — an
// explicit enum, not scattered boolean flags (CLAUDE.md §5.2), so a support
// agent, a refund, and a fraud reviewer can all reason about "what state is
// this order in" identically.
type State string

const (
	StateCreated        State = "created"
	StatePaymentPending State = "payment_pending"
	StatePaid           State = "paid"
	StateAwaitingShip   State = "awaiting_ship"
	StateShipped        State = "shipped"
	StateDelivered      State = "delivered"
	StateClaimWindow    State = "claim_window"
	StateReleased       State = "released"
	StateClaimOpen      State = "claim_open"
	StateRefunded       State = "refunded"  // terminal
	StateCancelled      State = "cancelled" // terminal
)

// transitions is design doc v2 §5.2's transition table, verbatim — keyed
// [from][to] -> trigger name, so Transition can reject an illegal edge
// before even attempting the database compare-and-swap. The claim_open ->
// released/refunded pair covers both full-refund and release outcomes; a
// partial refund (design doc v2 §9.2) still lands the order in one of
// these two terminal-ish states, with the partial amount recorded on the
// claim itself (internal/dispute, not yet built).
var transitions = map[State]map[State]string{
	StateCreated:        {StatePaid: "payment_intent.succeeded", StatePaymentPending: "ach_submitted"},
	StatePaymentPending: {StatePaid: "charge.succeeded", StateCancelled: "charge.failed"},
	StatePaid:           {StateAwaitingShip: "auto"},
	StateAwaitingShip:   {StateShipped: "tracking_uploaded", StateCancelled: "ship_timeout_72h"},
	StateShipped:        {StateDelivered: "carrier_delivered", StateRefunded: "no_delivery_scan_21d"},
	// trusted_release (design doc v2 §6.4): Gold/Hous Trust sellers skip
	// the claim window entirely, releasing on the delivery scan itself —
	// MarkDelivered (fulfillment.go) decides which edge applies per order.
	StateDelivered:   {StateClaimWindow: "auto", StateReleased: "trusted_release"},
	StateClaimWindow: {StateReleased: "claim_window_elapsed", StateClaimOpen: "claim_filed"},
	StateClaimOpen:   {StateReleased: "claim_resolved_release", StateRefunded: "claim_resolved_refund"},
}

var ErrInvalidTransition = errors.New("order: invalid state transition")

// Transition performs a single compare-and-swap: `update orders set state =
// $to where id = $orderID and state = $from`. RowsAffected == 0 always maps
// to ErrInvalidTransition, whether that's because a concurrent transition
// already moved this order elsewhere, or because from->to was never a legal
// edge to begin with — same "exactly one writer wins" property as
// auctions.closed_at/paid_at (internal/auction), generalized from two
// booleans to an eleven-state enum instead of inventing a new concurrency
// approach.
func Transition(ctx context.Context, pool *pgxpool.Pool, orderID string, from, to State) error {
	if _, ok := transitions[from][to]; !ok {
		return fmt.Errorf("%w: %s -> %s is not a legal edge", ErrInvalidTransition, from, to)
	}
	tag, err := pool.Exec(ctx, `
		update orders set state = $1, updated_at = now() where id = $2 and state = $3
	`, string(to), orderID, string(from))
	if err != nil {
		return fmt.Errorf("transition order: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidTransition
	}
	return nil
}

// Rail is which payment method the buyer actually used — matches
// orders.rail's check constraint (migration 0023).
type Rail string

const (
	RailCard Rail = "card"
	RailAch  Rail = "ach"
)

// CreateInput is everything CreateFromWin needs beyond bare identity: the
// pricing quote (pkg/fees.ComputeQuote's output, computed at
// checkout-intent time and re-verified fresh at capture time — never
// trusted from the client), which rail the buyer actually used, and the
// tier snapshot design doc v2 §10 requires be permanent: tier_pct_at_sale
// must never be recomputed from a seller's current tier after the fact, or
// historical reporting breaks the moment anyone gets promoted.
type CreateInput struct {
	Quote                 fees.Quote
	Rail                  Rail
	Tier                  string
	TierPct               float64
	StripePaymentIntentID string
	// StripeChargeID is the platform-side charge this order's payment
	// actually captured against — separate charges and transfers
	// (docs/Legal_MoneyTransitter.md) means this charge lives on the
	// platform's own Stripe account, never a seller's connected account.
	// Empty for the ACH rail (still clearing at order-creation time — no
	// charge exists yet) and for the no-Stripe mock-payment path.
	StripeChargeID string
	// ShippingPreset/SignatureRequired are a permanent snapshot, computed by
	// the caller (internal/shipping.UpgradePreset(listingsPreset,
	// finalAmountCents)) at the moment of sale — same "never recomputed
	// after the fact" rule as TierPct above, and for the same reason: a
	// seller changing their listing-time preset after the fact must never
	// retroactively loosen what an already-sold order ships at.
	// Deliberately a plain string/bool here, not internal/shipping.Preset
	// itself — this package doesn't import internal/shipping (which already
	// imports internal/order for the delivery webhook), so the caller does
	// the preset arithmetic and hands over the already-decided result.
	ShippingPreset    string
	SignatureRequired bool
}

// CreateFromWin inserts one orders row (state=created) and its single
// order_items row. This is the funnel point design doc v2 §5 calls for: a
// won auction (internal/auction's BuyNow / PayForWonAuction) and a
// fixed-price purchase (internal/listing's BuyNowFixed) both create
// exactly one Order through this one function, rather than each
// maintaining its own parallel notion of "what got sold."
//
// Also the row a won-via-bidding auction gets the instant it closes with a
// winner (internal/auction/close.go's createPendingOrderForWin) — Rail is
// unknown at that point (nil until FinalizePayment below attaches it), the
// only caller that ever passes an empty Rail.
//
// Called as a small, separately-committed step right after the atomic
// ownership compare-and-swap succeeds — not nested inside that transaction.
// This mirrors the existing convention in internal/auction/buynow.go
// (payment capture and markPaid are both separate post-commit steps, not
// part of the ownership CAS's transaction): only the ownership decision
// itself has to be atomic, everything layered on top of an already-won
// purchase is a best-effort follow-up write, logged rather than unwound on
// failure — reversing an already-committed purchase here would reintroduce
// exactly the double-sold race this whole flow exists to prevent.
func CreateFromWin(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID, sellerID string, in CreateInput) (string, error) {
	q := in.Quote
	feeBase := int64(q.Subtotal) + int64(q.Shipping)

	// The rail actually used determines which half of the quote is real —
	// discount_cents is always 0 on the card rail (design doc v2's own
	// schema sketch), and tax/total/processing-cost all come from whichever
	// side of the Quote the buyer's rail corresponds to.
	discountCents := int64(0)
	taxCents := int64(q.CardTax)
	chargedCents := int64(q.CardTotal)
	processingCostCents := int64(q.CardCost)
	if in.Rail == RailAch {
		discountCents = int64(q.Discount)
		taxCents = int64(q.BankTax)
		chargedCents = int64(q.BankTotal)
		processingCostCents = int64(q.BankCost)
	}

	shippingPreset := in.ShippingPreset
	if shippingPreset == "" {
		shippingPreset = "tracked_envelope"
	}

	var orderID string
	err := pool.QueryRow(ctx, `
		insert into orders (
			buyer_id, seller_id, state, rail, tier_at_sale, tier_pct_at_sale,
			subtotal_cents, shipping_cents, fee_base_cents, seller_fee_cents,
			seller_net_cents, discount_cents, tax_cents, charged_cents,
			processing_cost_cents, stripe_payment_intent_id, stripe_charge_id,
			shipping_preset, signature_required
		) values (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13, $14,
			$15, $16, $17,
			$18, $19
		) returning id
	`,
		buyerID, sellerID, string(StateCreated), nullableString(string(in.Rail)), in.Tier, in.TierPct,
		int64(q.Subtotal), int64(q.Shipping), feeBase, int64(q.SellerFee),
		int64(q.SellerNet), discountCents, taxCents, chargedCents,
		processingCostCents, nullableString(in.StripePaymentIntentID), nullableString(in.StripeChargeID),
		shippingPreset, in.SignatureRequired,
	).Scan(&orderID)
	if err != nil {
		return "", fmt.Errorf("insert order: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		insert into order_items (order_id, listing_id, price_cents) values ($1, $2, $3)
	`, orderID, listingID, int64(q.Subtotal)); err != nil {
		return "", fmt.Errorf("insert order item: %w", err)
	}

	return orderID, nil
}

// FinalizePayment attaches real payment details to an order that was
// already inserted, unpaid, at auction-close time (CreateFromWin, called
// from internal/auction/close.go with Rail empty) and moves it straight
// from created to paid or payment_pending in the same statement — the
// compare-and-swap on state = 'created' is what makes this safe against
// ever double-finalizing the same order (a buyer double-clicking Pay, a
// retry after a slow response), same "exactly one writer wins" property as
// Transition itself, just folded into one update since the fee fields and
// the state need to change together atomically. Callers still need a
// separate Transition(StatePaid, StateAwaitingShip) afterward for the card
// rail — this only ever lands on paid/payment_pending, never further.
func FinalizePayment(ctx context.Context, pool *pgxpool.Pool, orderID string, in CreateInput) error {
	newState := StatePaid
	if in.Rail == RailAch {
		newState = StatePaymentPending
	}

	q := in.Quote
	feeBase := int64(q.Subtotal) + int64(q.Shipping)
	discountCents := int64(0)
	taxCents := int64(q.CardTax)
	chargedCents := int64(q.CardTotal)
	processingCostCents := int64(q.CardCost)
	if in.Rail == RailAch {
		discountCents = int64(q.Discount)
		taxCents = int64(q.BankTax)
		chargedCents = int64(q.BankTotal)
		processingCostCents = int64(q.BankCost)
	}

	tag, err := pool.Exec(ctx, `
		update orders set
			state = $1, rail = $2, tier_at_sale = $3, tier_pct_at_sale = $4,
			subtotal_cents = $5, shipping_cents = $6, fee_base_cents = $7,
			seller_fee_cents = $8, seller_net_cents = $9, discount_cents = $10,
			tax_cents = $11, charged_cents = $12, processing_cost_cents = $13,
			stripe_payment_intent_id = $14, stripe_charge_id = $15,
			shipping_preset = $16, signature_required = $17, updated_at = now()
		where id = $18 and state = $19
	`,
		string(newState), nullableString(string(in.Rail)), in.Tier, in.TierPct,
		int64(q.Subtotal), int64(q.Shipping), feeBase, int64(q.SellerFee),
		int64(q.SellerNet), discountCents, taxCents, chargedCents,
		processingCostCents, nullableString(in.StripePaymentIntentID), nullableString(in.StripeChargeID),
		in.ShippingPreset, in.SignatureRequired, orderID, string(StateCreated),
	)
	if err != nil {
		return fmt.Errorf("finalize payment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidTransition
	}
	return nil
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
