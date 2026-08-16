package dispute

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// State is one of the claim ladder's states (design doc v2 §9.1).
type State string

const (
	StateOpened          State = "opened"
	StateNegotiating     State = "negotiating"
	StateEscalated       State = "escalated"
	StateAutoAdjudicated State = "auto_adjudicated"
	StateHumanReview     State = "human_review"
	StateDecided         State = "decided"
	StateAppealed        State = "appealed"
	StateClosed          State = "closed" // terminal
)

// ReasonCode is why a buyer opened a claim — matches design doc v2 §9.3's
// liability matrix rows exactly.
type ReasonCode string

const (
	ReasonNotAsDescribed               ReasonCode = "not_as_described"
	ReasonNotReceivedNoTracking        ReasonCode = "not_received_no_tracking"
	ReasonNotReceivedTrackingDelivered ReasonCode = "not_received_tracking_delivered"
	ReasonPaymentFraud                 ReasonCode = "payment_fraud"
	ReasonBuyersRemorse                ReasonCode = "buyers_remorse"
	ReasonTransitDamage                ReasonCode = "transit_damage"
)

// Resolution is what actually happens to the money.
type Resolution string

const (
	ResolutionRefundBuyer    Resolution = "refund_buyer"
	ResolutionDeny           Resolution = "deny"
	ResolutionPartialRefund  Resolution = "partial_refund"
	ResolutionPlatformAbsorb Resolution = "platform_absorb"
)

// LiableParty is who's on the hook — design doc v2 §9.3's matrix, made
// auditable instead of an ad hoc judgment call each time.
type LiableParty string

const (
	LiablePartySeller   LiableParty = "seller"
	LiablePartyBuyer    LiableParty = "buyer"
	LiablePartyPlatform LiableParty = "platform"
)

// transitions is the claim ladder's transition table (design doc v2 §9.1),
// same explicit-enum-not-scattered-booleans shape as internal/order's.
// Two shortcuts off StateNegotiating exist alongside the normal escalation
// path: "resolved_by_agreement" (the parties work it out themselves — no
// money beyond the original charge moves) and "negotiated_settlement" (a
// partial-refund offer gets accepted, §9.2 — expected to close most claims
// in minutes, so it skips the whole escalation ladder rather than forcing
// a negotiated settlement through auto-adjudication/human-review first).
var transitions = map[State]map[State]string{
	StateOpened: {StateNegotiating: "auto"},
	StateNegotiating: {
		StateEscalated: "escalated",
		StateDecided:   "negotiated_settlement",
		StateClosed:    "resolved_by_agreement",
	},
	StateEscalated:       {StateAutoAdjudicated: "auto_rule_matched", StateHumanReview: "no_auto_rule"},
	StateAutoAdjudicated: {StateDecided: "resolution_executed"},
	StateHumanReview:     {StateDecided: "reviewer_decision"},
	StateDecided:         {StateAppealed: "appeal_filed", StateClosed: "appeal_window_elapsed"},
	StateAppealed:        {StateClosed: "appeal_decided"}, // one appeal, final — appealed only ever resolves to closed, never loops back
}

var ErrInvalidTransition = errors.New("dispute: invalid state transition")

// Transition is the same compare-and-swap pattern as internal/order.
// Transition — exactly one writer wins, generalized to this state machine
// instead of a second bespoke implementation.
func Transition(ctx context.Context, pool *pgxpool.Pool, claimID string, from, to State) error {
	if _, ok := transitions[from][to]; !ok {
		return fmt.Errorf("%w: %s -> %s is not a legal edge", ErrInvalidTransition, from, to)
	}
	tag, err := pool.Exec(ctx, `
		update claims set state = $1 where id = $2 and state = $3
	`, string(to), claimID, string(from))
	if err != nil {
		return fmt.Errorf("transition claim: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidTransition
	}
	return nil
}
