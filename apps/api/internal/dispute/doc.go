// Package dispute implements the resolution-center state machine: opened ->
// direct negotiation (48h) -> escalation -> admin evidence review -> decision
// -> appeal window. See CLAUDE.md §6.5 and the design doc §6.
package dispute
