// Package dispute implements the claims ladder from design doc v2 §9:
// opened -> direct negotiation (48h) -> escalation -> auto-adjudication (for
// clear cases) or human review -> decision -> one appeal -> closed. Liability
// (§9.3's matrix — who's on the hook for a given reason code and evidence
// state) is encoded directly on claims.liable_party, not re-derived by
// whoever's looking at a case.
package dispute
