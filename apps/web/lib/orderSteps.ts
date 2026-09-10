import type { OrderState } from "./api";

// The happy-path order lifecycle (design doc v2 §5), shared between the
// full order-status timeline (OrderStatusPanel) and the csfloat-style
// per-row stepper on the Transactions list (TransactionStepper) — one
// source of truth for step order/labels so the two views can never drift
// apart.
export const ORDER_STEPS: { state: OrderState; label: string }[] = [
  { state: "paid", label: "Paid" },
  { state: "awaiting_ship", label: "Awaiting shipment" },
  { state: "shipped", label: "Shipped" },
  { state: "delivered", label: "Delivered" },
  { state: "claim_window", label: "Claim window" },
  { state: "released", label: "Released to seller" },
];

// created/payment_pending both precede real payment completion (design doc
// v2 §5's created -> payment_pending -> paid chain) but aren't listed steps
// of their own — a plain ORDER_STEPS.findIndex on either returns -1 (every
// bubble gray, nothing "current"), which used to be harmless because no
// order was ever actually observed sitting in one of those two states. Now
// that a won-via-bidding auction gets a real, unpaid order row the instant
// it closes (internal/auction/close.go's createPendingOrderForWin), both
// states are real and need to render as the Paid step's current bubble.
const STEP_ALIASES: Partial<Record<OrderState, OrderState>> = {
  created: "paid",
  payment_pending: "paid",
};

export function stepIndexForState(state: OrderState): number {
  return ORDER_STEPS.findIndex((s) => s.state === (STEP_ALIASES[state] ?? state));
}

// A terminal state (refunded/cancelled) or claim_open falls outside the
// happy-path steps above — rendered as its own line rather than forced
// onto the linear timeline, since it isn't a step in a sequence so much as
// an exit from it.
export const ORDER_OFF_PATH_LABELS: Partial<Record<OrderState, string>> = {
  cancelled: "Cancelled — refunded in full",
  refunded: "Refunded",
  claim_open: "Claim open — under review",
};
