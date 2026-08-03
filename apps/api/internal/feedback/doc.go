// Package feedback is a v1 seller rating+comment system: a logged-in user
// can leave one 1-5 star rating plus an optional comment per seller
// (apps/api/migrations/0009_seller_profiles.up.sql), shown on the seller's
// public profile page — but only after winning at least one of that
// seller's auctions (HasWonAuctionFrom), mirroring eBay's own requirement
// that feedback follows a completed transaction. There's no real
// Order/checkout system yet (fixed-price purchase is still a disabled
// placeholder button, CLAUDE.md §8), so "won an ended auction" is the
// closest honest proxy for "bought from" available today — not a
// completed, paid, shipped transaction, just the auction-close outcome.
// This is still deliberately simpler than CLAUDE.md §6.3's eventual
// design — overall score + detailed rating axes (condition/grade accuracy
// weighted highest, communication, shipping speed, shipping/handling
// value). Upgrade path: once a real Order/escrow model exists, gate on a
// completed order instead of an auction win, and split Rating into the
// detailed axes.
package feedback
