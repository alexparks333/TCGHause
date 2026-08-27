// Package shipping integrates real carrier label purchase via Shippo
// (HandleBuyLabel/BuyLabel — docs/Shipping_Research.md §1/§5) and ingests
// delivery-confirmation webhooks, which drive the order state machine's
// shipped->delivered transition and downstream payout-release timers
// (internal/payout). Domestic-only in v1. See CLAUDE.md §6.11, design doc
// v2 §5.3.
//
// Shippo, not EasyPost: the research recommended EasyPost first, but that
// account never cleared EasyPost's account-verification wall despite
// repeated support contact — Shippo was the credible fallback in that same
// research and is what's actually wired up. Shippo has no official Go SDK,
// so shippo.go is a plain net/http client against api.goshippo.com rather
// than a wrapped library; every vendor-specific detail (request/response
// shapes, auth header, polling behavior) lives entirely in that one file.
//
// tier.go's Tier (standard/tracked/signature) is the value-driven policy
// docs/Shipping_Research.md's synthesis section led to: $100 crosses into
// mandatory tracking, $500 into mandatory signature confirmation. A named
// but explicitly NOT-YET-BUILT fourth policy — mandatory buyer/seller
// authentication above $150 — has no code anywhere in this package; don't
// infer one.
//
// HandleDeliveryWebhook (webhook.go) is still the carrier-agnostic stand-in
// its own doc comment describes — label purchase going live doesn't change
// that a real Shippo tracker-webhook handler (their own signature scheme,
// not the shared-secret HMAC below) hasn't been built yet. That's the next
// piece once label purchase itself is validated end-to-end.
package shipping
