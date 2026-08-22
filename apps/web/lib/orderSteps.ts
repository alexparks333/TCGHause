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

// A terminal state (refunded/cancelled) or claim_open falls outside the
// happy-path steps above — rendered as its own line rather than forced
// onto the linear timeline, since it isn't a step in a sequence so much as
// an exit from it.
export const ORDER_OFF_PATH_LABELS: Partial<Record<OrderState, string>> = {
  cancelled: "Cancelled — refunded in full",
  refunded: "Refunded",
  claim_open: "Claim open — under review",
};
