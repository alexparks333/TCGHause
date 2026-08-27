package order

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/seller"
)

// ReleaseFunds is the money-movement half of every path that lands an
// order in the released state (claim window elapsed with no claim,
// MarkDelivered's trusted-seller instant release, or a claim resolving in
// the seller's favor) — separate charges and transfers
// (docs/Legal_MoneyTransitter.md) means the buyer's charge has sat in the
// PLATFORM's own Stripe balance the whole time up to this point, so
// reaching released doesn't move any money on its own; this is the one
// explicit Transfer call that actually does. Callers are expected to have
// already performed the released state transition (and stamped
// released_at) before calling this — ReleaseFunds only ever moves money,
// it never touches order state itself.
//
// The transferred amount is seller_net_cents minus refunded_cents minus
// label_cost_cents. The label deduction matters for both shipping-cost
// cases this platform supports: on a paid preset, the buyer's shipping
// payment already inflated seller_net_cents by roughly shipping_cents, and
// the platform then spends real money buying that seller a label via
// Shippo/Pitney Bowes — without this deduction the seller would keep the
// shipping charge AND receive a free label, effectively double-paid for
// shipping. On a free preset, shipping_cents is 0 (the buyer was charged
// nothing) but the seller still promised to cover shipping themselves —
// deducting the label's real cost here is what actually makes that
// promise land on the seller rather than silently landing on the
// platform, which is what happens without this (the gap was found via a
// free_envelope auction that auto-upgrades to free_bubble_mailer,
// shipping.UpgradePreset — a real Shippo Ground Advantage label costs
// meaningfully more than the flat envelope rate the seller had in mind).
// label_cost_cents is null whenever a seller shipped manually (never
// bought a label through this platform) — no deduction in that case,
// since the platform never spent anything on their behalf.
//
// A partial refund (internal/dispute.executePartialRefund) comes entirely
// out of the seller's take, never the platform's fee, so by the time an
// order actually reaches released its remaining entitlement may already be
// less than what was quoted at sale time. Best-effort: a failed Transfer is
// returned to the caller to log, never left to block the order's state
// transition that already happened — a seller not yet paid out is a
// recoverable, visible problem; an order stuck mid-transition helps no one.
func ReleaseFunds(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string) error {
	if !paymentClient.IsConfigured() {
		return nil
	}

	var sellerID string
	var sellerNetCents, refundedCents int64
	var labelCostCents *int64
	if err := pool.QueryRow(ctx, `
		select seller_id, seller_net_cents, refunded_cents, label_cost_cents from orders where id = $1
	`, orderID).Scan(&sellerID, &sellerNetCents, &refundedCents, &labelCostCents); err != nil {
		return fmt.Errorf("read order for release: %w", err)
	}

	amountCents := sellerNetCents - refundedCents
	if labelCostCents != nil {
		amountCents -= *labelCostCents
	}
	// A label costing more than the seller's remaining net (a cheap
	// free-shipping item where the real label rate exceeds the item's own
	// proceeds) just skips the transfer rather than going negative — there
	// is no mechanism to claw back funds from a seller after the fact, so
	// the platform absorbs that gap rather than the seller ending up owing
	// money. Rare in practice (it needs a free-shipping order whose label
	// cost outweighs its own net), but a real possible outcome, not a bug.
	if amountCents <= 0 {
		return nil
	}

	stripeAccountID, err := seller.StripeAccountID(ctx, pool, sellerID)
	if err != nil {
		return err
	}
	if stripeAccountID == "" {
		return fmt.Errorf("order %s: seller %s has no stripe account to transfer to", orderID, sellerID)
	}

	tr, err := paymentClient.CreateTransfer(ctx, stripeAccountID, amountCents)
	if err != nil {
		return fmt.Errorf("transfer released funds: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		update orders set stripe_transfer_id = $1 where id = $2
	`, tr.ID, orderID); err != nil {
		return fmt.Errorf("record transfer id: %w", err)
	}
	return nil
}
