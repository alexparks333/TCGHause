// Package search ranks and filters listings. v1 is Postgres full-text +
// item-specifics filters sorted by relevance/recency/price; a Cassini-style
// weighted ranking (seller performance, listing quality, engagement) is a
// v2 upgrade once there's enough traffic to tune it. See CLAUDE.md §6.7.
package search
