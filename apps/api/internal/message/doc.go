// Package message is real buyer/seller direct messaging — the backend
// behind the account "Messages" page, which until now rendered
// apps/web/lib/mock-account.ts's hardcoded myMessages (CLAUDE.md §6.13/§8
// named this the last still-mock account surface).
//
// One thread per unordered pair of users (see migrations/0028_messages),
// started either from a listing's "Message seller" button or a seller's
// profile page. Read state is tracked per participant per thread
// (message_thread_reads), not per message — opening a thread marks the
// whole conversation read in one upsert, the same "derive, don't flip a
// flag per row" shape as notification.MarkAllRead. This is distinct from
// internal/dispute's claim messages (ClaimEvent kind "message"), which are
// evidence-and-negotiation entries scoped to one order's claim, not a
// general inbox.
package message
