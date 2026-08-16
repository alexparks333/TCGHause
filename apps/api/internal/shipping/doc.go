// Package shipping integrates carrier label purchase (Shippo/EasyPost) and
// ingests delivery-confirmation webhooks, which drive the order state
// machine's shipped->delivered transition and downstream payout-release
// timers (internal/payout) for both tracked and PWE shipments. Domestic-only
// in v1. See CLAUDE.md §6.11, design doc v2 §5.3.
package shipping
