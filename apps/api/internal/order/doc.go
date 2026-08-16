// Package order handles checkout: turning a winning bid or a fixed-price
// purchase (single-seller only, per design doc v2 §1.1) into an Order with an
// explicit state machine (created/payment_pending/paid/awaiting_ship/shipped/
// delivered/claim_window/released/claim_open/refunded/cancelled — design doc
// v2 §5) that a support agent, a refund, and a fraud reviewer can all reason
// about identically. See internal/payout for release timing.
package order
