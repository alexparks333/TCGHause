// Package shipping integrates carrier label purchase (Shippo/EasyPost) and
// ingests delivery-confirmation webhooks, which drive escrow release timers
// for both tracked and PWE shipments. Domestic-only in v1. See CLAUDE.md
// §6.11.
package shipping
