// Package feedback is a v1 seller rating+comment system: a logged-in user
// can leave one 1-5 star rating plus an optional comment per *purchase*
// (apps/api/migrations/0009_seller_profiles.up.sql,
// 0012_reviews_per_purchase.up.sql) — each review is tied to one specific
// purchase (EligibleListingsToReview/wonListingFrom, Upsert's listingID
// param): a won auction (however it sold — regular bidding or Buy It Now)
// or a fixed-format listing bought outright. Buying N times from the same
// seller earns N reviewable purchases, not one review total, and a
// reviewer who has never bought from a seller has zero. Mirrors eBay's own
// requirement that feedback follows a completed transaction, applied
// per-transaction rather than per-relationship. There's still no real Order
// model (internal/order, design doc v2 §5) wired in here yet — a purchase's
// own outcome/buyer_id (and, for a paid one, paid_at — migration 0019) is the
// closest honest proxy for "bought from" available today, not a
// shipped/delivered transaction. This is still deliberately simpler than
// CLAUDE.md §6.3's eventual design — overall score + detailed rating axes
// (condition/grade accuracy weighted highest, communication, shipping
// speed, shipping/handling value). Upgrade path: once internal/order's state
// machine is wired in, gate on a released order instead of a bare purchase,
// and split Rating into the detailed axes.
package feedback
