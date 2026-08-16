// Package notification is the persistent, in-app notification list behind
// the header bell (notification.go): "won"/"sold" (auction close) and
// "outbid" (a bid displacing the previous high bidder) rows, each written
// in the same transaction as the event that caused it. This is deliberately
// separate from the one-time celebration toast (internal/auction/
// celebration.go) — that plays once and is gone; this is a running,
// markable-as-read list a user can revisit later. Email/push/websocket
// delivery and watchlist/saved-search triggers are still unbuilt — see
// CLAUDE.md §6.8.
package notification
