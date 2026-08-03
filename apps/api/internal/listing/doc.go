// Package listing handles listing create/get/list (auction and
// fixed-price — see listing.go). Cart batching for sub-$20 singles and the
// bulk CSV/API listing path gated to Tier 3 sellers (CLAUDE.md §6.9) are
// not built yet — v1 scope is a single listing created and fetched one at
// a time.
package listing
