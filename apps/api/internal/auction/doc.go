// Package auction implements proxy bidding with a fixed hard-close
// (auction.go): private max-bid storage, race-safe bid placement via the
// auctions.version optimistic-concurrency column, and a fixed end time —
// no soft-close/auto-extend. This deliberately overrides CLAUDE.md §6.1's
// original eBay-soft-close recommendation: whoever holds the highest bid
// the instant the clock hits zero wins, matching eBay's actual classic
// default rather than the auto-extend pilot feature. Backed directly by
// Postgres for now rather than the Redis-backed hot path CLAUDE.md §6.1
// describes long-term — that's a scale optimization for high concurrent-bid
// traffic on one auction, not a correctness requirement, and isn't needed
// until real traffic justifies it. See CLAUDE.md §5.3 and §6.1.
package auction
