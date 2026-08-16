// Package payout controls *when* a Connect direct charge's already-seller-owned
// funds get paid out, never custody of them: it schedules and batches calls to
// Stripe's Payouts API against each seller's connected account (manual payout
// schedule, weekly batching by default), gated by order state and seller tier.
// Design doc v2 §6 is explicit that "escrow" is never the right word here — the
// platform never holds these funds at any point. See design doc v2 §5-§6.
package payout
