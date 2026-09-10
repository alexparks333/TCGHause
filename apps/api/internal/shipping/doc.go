// Package shipping integrates real carrier label purchase across two
// vendors, locked to two different fulfillment mechanisms (preset.go's
// Mechanism), and ingests delivery-confirmation webhooks, which drive the
// order state machine's shipped->delivered transition and downstream
// payout-release timers (internal/payout). Domestic-only in v1. See
// CLAUDE.md §6.11/§6.18, design doc v2 §5.3.
//
//   - Shippo (shippo.go) buys real tracked-PACKAGE labels — Ground
//     Advantage and the free_bubble_mailer/free_box presets. Shippo, not
//     EasyPost: the research recommended EasyPost first, but that account
//     never cleared EasyPost's account-verification wall despite repeated
//     support contact — Shippo was the credible fallback in that same
//     research and is what's actually wired up. Shippo has no official Go
//     SDK, so shippo.go is a plain net/http client against
//     api.goshippo.com rather than a wrapped library; every vendor-
//     specific detail (request/response shapes, auth header, polling
//     behavior) lives entirely in that one file.
//   - Pitney Bowes (pitneybowes.go) buys real tracked-ENVELOPE labels —
//     USPS First-Class Mail with an Intelligent Mail Barcode (IMb), the
//     tracked_envelope/free_envelope presets. This is the mechanism that
//     makes tracking viable on sub-$20 raw singles, where a package-class
//     tracked rate (Shippo's cheapest floor, ~$6-9) would eat the entire
//     sale — see docs/Shipping_Research.md §3. Every endpoint path, field
//     name, and gotcha in that file (which platform of Pitney Bowes' two
//     unrelated ones this actually is, the v2-vs-v1 Create Shipment split,
//     the IMb-specific labelSize enum) was found live, not from static
//     docs — see that file's own doc comment for the full trail.
//
// preset.go's Preset (free_envelope/free_bubble_mailer/free_box/
// tracked_envelope/shippo_ground_advantage) is the value-driven policy
// docs/Shipping_Research.md's synthesis section led to, superseding an
// earlier tier.go (standard/tracked/signature) that no longer exists —
// each preset is locked to exactly one Mechanism (letter -> Pitney Bowes,
// package -> Shippo), and UpgradePreset only ever escalates a listing's
// chosen preset to a stricter mechanism at high sale prices, never loosens
// it. $100 crosses into mandatory package mechanism, $500 into mandatory
// signature confirmation (a package-only concept).
//
// address.Normalize (internal/address) matters to both vendors here:
// Shippo tolerated a free-text country value like "USA", Pitney Bowes'
// stricter ISO-3166-1-alpha-2 validation didn't — found live, fixed at
// the address layer (not per-vendor) since both clients consume the same
// stored Address.
//
// HandleDeliveryWebhook (webhook.go) is still the carrier-agnostic stand-in
// its own doc comment describes — real label purchase on both vendors
// doesn't change that a real per-carrier tracker-webhook handler (each
// vendor's own signature scheme, not the shared-secret HMAC below) hasn't
// been built yet. TrackShipment (track.go) covers polling in the
// meantime, working for either vendor's tracking number since it's a
// carrier passthrough, not scoped to shipments either vendor itself sold.
package shipping
