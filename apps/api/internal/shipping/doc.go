// Package shipping integrates real carrier label purchase via EasyPost
// (HandleBuyLabel/BuyLabel — docs/Shipping_Research.md §1/§5, chosen over
// Shippo per that research) and ingests delivery-confirmation webhooks,
// which drive the order state machine's shipped->delivered transition and
// downstream payout-release timers (internal/payout). Domestic-only in v1.
// See CLAUDE.md §6.11, design doc v2 §5.3.
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
// that a real EasyPost tracker-webhook handler (their own signature scheme,
// not the shared-secret HMAC below) hasn't been built yet. That's the next
// piece once label purchase itself is validated end-to-end.
package shipping
