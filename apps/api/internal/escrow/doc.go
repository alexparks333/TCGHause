// Package escrow implements the escrow-hold state machine:
// held -> release_pending -> released, or -> disputed -> refunded. Release
// timing is driven by seller tier and shipment tracking events, per the
// design doc §3 and CLAUDE.md §5.2.
package escrow
