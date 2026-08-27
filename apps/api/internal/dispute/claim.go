package dispute

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/chargeback"
	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
)

var (
	ErrNotBuyer          = errors.New("dispute: only the buyer can open a claim")
	ErrNotParticipant    = errors.New("dispute: caller is not a participant in this order")
	ErrOrderNotClaimable = errors.New("dispute: this order is not in its claim window")
	ErrAlreadyAppealed   = errors.New("dispute: this claim has already been appealed once")
	ErrNotNegotiating    = errors.New("dispute: this claim is not open for negotiation")
	ErrNotUnderReview    = errors.New("dispute: this claim is not awaiting a decision")
)

// OpenClaim starts a claim against orderID — only the buyer can (every
// reason code in design doc v2 §9.3's matrix is framed from the buyer's
// side), and only while the order is genuinely in its claim window
// (matches internal/order's own transition table: claim_window ->
// claim_open is the only edge the "claim_filed" trigger fires on).
// Transitions the order itself alongside the new claim, and immediately
// advances the claim from opened to negotiating — "opened" exists as a
// state to land the first insert in, not a state anything sits in.
func OpenClaim(ctx context.Context, pool *pgxpool.Pool, orderID, buyerID string, reasonCode ReasonCode, body string) (string, error) {
	o, err := order.GetByID(ctx, pool, orderID)
	if err != nil {
		return "", err
	}
	if buyerID != o.BuyerID {
		return "", ErrNotBuyer
	}
	if o.State != order.StateClaimWindow {
		return "", ErrOrderNotClaimable
	}

	var claimID string
	if err := pool.QueryRow(ctx, `
		insert into claims (order_id, opened_by, reason_code) values ($1, $2, $3)
		returning id
	`, orderID, buyerID, string(reasonCode)).Scan(&claimID); err != nil {
		return "", fmt.Errorf("insert claim: %w", err)
	}

	if body != "" {
		if err := addEvent(ctx, pool, claimID, buyerID, EventMessage, &body, nil); err != nil {
			return "", err
		}
	}

	if err := order.Transition(ctx, pool, orderID, order.StateClaimWindow, order.StateClaimOpen); err != nil {
		return "", fmt.Errorf("transition order to claim_open: %w", err)
	}

	if err := Transition(ctx, pool, claimID, StateOpened, StateNegotiating); err != nil {
		return "", fmt.Errorf("transition claim to negotiating: %w", err)
	}

	return claimID, nil
}

func addEvent(ctx context.Context, pool *pgxpool.Pool, claimID, actorID string, kind EventKind, body *string, amountCents *int64) error {
	_, err := pool.Exec(ctx, `
		insert into claim_events (claim_id, actor_id, kind, body, amount_cents) values ($1, $2, $3, $4, $5)
	`, claimID, actorID, string(kind), body, amountCents)
	if err != nil {
		return fmt.Errorf("insert claim event: %w", err)
	}
	return nil
}

// requireParticipant confirms actorID is either the order's buyer or
// seller before letting them touch a claim on it.
func requireParticipant(ctx context.Context, pool *pgxpool.Pool, orderID, actorID string) error {
	o, err := order.GetByID(ctx, pool, orderID)
	if err != nil {
		return err
	}
	if actorID != o.BuyerID && actorID != o.SellerID {
		return ErrNotParticipant
	}
	return nil
}

// AddMessage posts to the negotiation thread — either party, at any point
// before the claim closes.
func AddMessage(ctx context.Context, pool *pgxpool.Pool, claimID, actorID, body string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	return addEvent(ctx, pool, claimID, actorID, EventMessage, &body, nil)
}

// AddEvidence attaches an already-uploaded photo/document's URL to the
// claim — same "upload client-side, record the URL here" split as
// internal/order's shipping evidence.
func AddEvidence(ctx context.Context, pool *pgxpool.Pool, claimID, actorID, url string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	return addEvent(ctx, pool, claimID, actorID, EventEvidence, &url, nil)
}

// ResolveByAgreement closes a claim the parties worked out themselves — no
// refund, no escalation, the "Resolved: Dispute Closed" branch of design
// doc v2 §9's own diagram. Either party can call this; it's a mutual
// closure, not one side unilaterally winning.
func ResolveByAgreement(ctx context.Context, pool *pgxpool.Pool, claimID, actorID string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	if c.State != StateNegotiating {
		return ErrNotNegotiating
	}
	if err := addEvent(ctx, pool, claimID, actorID, EventMessage, ptr("resolved by mutual agreement"), nil); err != nil {
		return err
	}
	if err := Transition(ctx, pool, claimID, StateNegotiating, StateClosed); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `update claims set resolved_at = now() where id = $1`, claimID)
	return err
}

// ProposePartialRefund records a "keep it, take X% back" offer (design doc
// v2 §9.2) — either party can propose one, during negotiation.
func ProposePartialRefund(ctx context.Context, pool *pgxpool.Pool, claimID, actorID string, amountCents int64) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	if c.State != StateNegotiating {
		return ErrNotNegotiating
	}
	return addEvent(ctx, pool, claimID, actorID, EventPartialRefundOffer, nil, &amountCents)
}

// AcceptPartialRefund accepts the most recent partial-refund offer,
// executes the real Stripe partial refund, and closes the claim straight
// out of negotiation — a negotiated settlement skips the whole
// escalation/auto-adjudication/human-review ladder, matching design doc
// v2 §9.2's expectation that most of these close in minutes.
func AcceptPartialRefund(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, claimID, actorID string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	if c.State != StateNegotiating {
		return ErrNotNegotiating
	}

	var amountCents int64
	if err := pool.QueryRow(ctx, `
		select amount_cents from claim_events
		where claim_id = $1 and kind = $2
		order by created_at desc limit 1
	`, claimID, string(EventPartialRefundOffer)).Scan(&amountCents); err != nil {
		return fmt.Errorf("read latest partial refund offer: %w", err)
	}

	o, err := order.GetByID(ctx, pool, c.OrderID)
	if err != nil {
		return err
	}
	if err := executePartialRefund(ctx, pool, paymentClient, o, amountCents); err != nil {
		return err
	}

	resolution := ResolutionPartialRefund
	if _, err := pool.Exec(ctx, `
		update claims set resolution = $1, refund_cents = $2 where id = $3
	`, string(resolution), amountCents, claimID); err != nil {
		return fmt.Errorf("record partial refund resolution: %w", err)
	}
	if err := addEvent(ctx, pool, claimID, actorID, EventDecision, ptr("partial refund accepted"), &amountCents); err != nil {
		return err
	}
	if err := Transition(ctx, pool, claimID, StateNegotiating, StateDecided); err != nil {
		return err
	}

	// Item stays with the buyer, seller still gets paid (minus what just
	// went back to the buyer) — the order proceeds to release, same as if
	// the claim window had simply elapsed with no claim at all.
	if err := releaseOrder(ctx, pool, paymentClient, o.ID); err != nil {
		return fmt.Errorf("release order after partial refund: %w", err)
	}
	_, err = pool.Exec(ctx, `update claims set resolved_at = now() where id = $1`, claimID)
	return err
}

// Escalate moves a claim past direct negotiation — either because 48h
// passed with no resolution (cmd/worker, not yet wired to call this
// automatically) or because either party asked to escalate. Runs
// auto-adjudication (design doc v2 §9.1) immediately: a clear case lands
// in auto_adjudicated with its resolution already executed against Stripe;
// everything else lands in human_review, which is also the one point in
// this whole package that sends a real email — the cases that actually
// need a person, not every claim opened (most resolve via negotiation or
// auto-adjudication without anyone at support touching them).
func Escalate(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, mailClient *mail.Client, webOrigin, claimID string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if c.State != StateNegotiating {
		return ErrNotNegotiating
	}
	if err := Transition(ctx, pool, claimID, StateNegotiating, StateEscalated); err != nil {
		return err
	}

	o, err := order.GetByID(ctx, pool, c.OrderID)
	if err != nil {
		return err
	}

	resolution, liable, matched := autoAdjudicate(c.ReasonCode, o.TrackingNumber != nil, o.DeliveredAt != nil, o.ChargedCents)
	if !matched {
		if err := Transition(ctx, pool, claimID, StateEscalated, StateHumanReview); err != nil {
			return err
		}
		notifyHumanReview(ctx, mailClient, webOrigin, c)
		return nil
	}

	if err := Transition(ctx, pool, claimID, StateEscalated, StateAutoAdjudicated); err != nil {
		return err
	}
	return finalizeDecision(ctx, pool, paymentClient, claimID, o, "", resolution, liable, 0, StateAutoAdjudicated)
}

// notifyHumanReview alerts support that a claim needs a person — best
// effort: a failed/unsent email is logged, not returned, because the claim
// having already landed in human_review is the state that actually matters
// and must stand regardless (same "state transition is the real event"
// reasoning as releaseOrder's Transfer failure below). Links straight into
// the real Workers-side decide screen (apps/web/app/admin/claims/[id]) —
// not a raw API call — now that page exists.
func notifyHumanReview(ctx context.Context, mailClient *mail.Client, webOrigin string, c *Claim) {
	if !mailClient.IsConfigured() {
		return
	}
	subject := fmt.Sprintf("Claim %s needs review — %s", c.TicketNumber, reasonLabels[c.ReasonCode])
	html := fmt.Sprintf(`
		<p><strong>%s</strong> has escalated to human review — no auto-adjudication rule matched it.</p>
		<ul>
			<li><strong>Reason:</strong> %s</li>
			<li><strong>Order ID:</strong> %s</li>
		</ul>
		<p><a href="%s/admin/claims/%s">Review and decide this claim &rarr;</a></p>
	`, c.TicketNumber, reasonLabels[c.ReasonCode], c.OrderID, webOrigin, c.ID)
	if err := mailClient.Send(ctx, subject, html); err != nil {
		log.Printf("dispute: failed to send human-review notification for claim %s: %v", c.ID, err)
	}
}

// reasonLabels gives the notification email a readable reason instead of a
// raw enum value — the frontend has its own copy (ClaimPanel.tsx's
// REASON_LABELS) for the UI, so this one stays unexported and backend-only.
var reasonLabels = map[ReasonCode]string{
	ReasonNotAsDescribed:               "Item wasn't as described",
	ReasonNotReceivedNoTracking:        "Never arrived (no tracking)",
	ReasonNotReceivedTrackingDelivered: "Never arrived (tracking shows delivered)",
	ReasonPaymentFraud:                 "I didn't make this purchase",
	ReasonBuyersRemorse:                "Changed my mind",
	ReasonTransitDamage:                "Arrived damaged",
}

// autoAdjudicate is design doc v2 §9.1's auto-adjudication rules, pure and
// independently testable (same shape as internal/seller's decideTier):
//   - no tracking + not-received -> refund buyer, seller liable
//   - tracking delivered + not-received + order under $50 -> refund buyer,
//     platform absorbs (not worth disputing a small claim)
//   - everything else, INCLUDING "flaw visible in listing photo" -> human
//     review. §9.1 lists that case under "auto-adjudication for clear
//     cases," but comparing a claim photo against the original listing
//     photo is a computer-vision problem this repo has no infrastructure
//     for — routed to a human with both photos attached instead of
//     pretending to automate it.
func autoAdjudicate(reason ReasonCode, hasTracking, delivered bool, chargedCents int64) (Resolution, LiableParty, bool) {
	const smallClaimThresholdCents = 5000
	switch {
	case reason == ReasonNotReceivedNoTracking && !hasTracking:
		return ResolutionRefundBuyer, LiablePartySeller, true
	case reason == ReasonNotReceivedTrackingDelivered && delivered && chargedCents < smallClaimThresholdCents:
		return ResolutionRefundBuyer, LiablePartyPlatform, true
	default:
		return "", "", false
	}
}

// Decide is the human-review path: an admin reviewer renders a decision
// (internal/dispute has no human review UI beyond a bare authenticated
// route — see http.go — no admin app exists in this repo to build a real
// one against yet).
func Decide(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, claimID, reviewerID string, resolution Resolution, liable LiableParty, refundCents int64) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if c.State != StateHumanReview {
		return ErrNotUnderReview
	}
	o, err := order.GetByID(ctx, pool, c.OrderID)
	if err != nil {
		return err
	}
	return finalizeDecision(ctx, pool, paymentClient, claimID, o, reviewerID, resolution, liable, refundCents, StateHumanReview)
}

// finalizeDecision records the resolution, executes its real money
// movement against Stripe, and advances both the claim and its order to
// their terminal-ish states. Shared by the auto-adjudication path
// (reviewerID empty — the system decided) and the human-review path.
func finalizeDecision(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, claimID string, o *order.Order, reviewerID string, resolution Resolution, liable LiableParty, refundCents int64, from State) error {
	var reviewer *string
	if reviewerID != "" {
		reviewer = &reviewerID
	}
	if _, err := pool.Exec(ctx, `
		update claims set resolution = $1, liable_party = $2, refund_cents = $3, reviewer_id = $4
		where id = $5
	`, string(resolution), string(liable), nullableAmount(refundCents), reviewer, claimID); err != nil {
		return fmt.Errorf("record decision: %w", err)
	}

	// claim_events.actor_id is not-null — auto-adjudication has no human
	// actor to attribute this to, so it's recorded against the claim's own
	// opener (the buyer whose claim triggered the rule), with the body
	// text itself making clear this was a system decision, not a person's.
	actor := o.BuyerID
	prefix := "auto-adjudicated: "
	if reviewerID != "" {
		actor = reviewerID
		prefix = "reviewer decision: "
	}
	body := fmt.Sprintf("%sresolution=%s liable=%s", prefix, resolution, liable)
	if err := addEvent(ctx, pool, claimID, actor, EventDecision, &body, nil); err != nil {
		return err
	}

	if err := Transition(ctx, pool, claimID, from, StateDecided); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `update claims set resolved_at = now() where id = $1`, claimID); err != nil {
		return fmt.Errorf("stamp resolved_at: %w", err)
	}

	switch resolution {
	case ResolutionRefundBuyer, ResolutionPlatformAbsorb:
		if err := executeFullRefund(ctx, pool, paymentClient, o); err != nil {
			return err
		}
		return order.Transition(ctx, pool, o.ID, order.StateClaimOpen, order.StateRefunded)
	case ResolutionPartialRefund:
		if err := executePartialRefund(ctx, pool, paymentClient, o, refundCents); err != nil {
			return err
		}
		return releaseOrder(ctx, pool, paymentClient, o.ID)
	case ResolutionDeny:
		return releaseOrder(ctx, pool, paymentClient, o.ID)
	default:
		return fmt.Errorf("dispute: unknown resolution %q", resolution)
	}
}

// releaseOrder transitions o.ID from claim_open to released, stamps
// released_at, and transfers what's left of the seller's take
// (order.ReleaseFunds) — shared by finalizeDecision's partial-refund/deny
// resolutions and AcceptPartialRefund, the three ways a claim can resolve
// with the seller still getting paid. A Transfer failure is logged, not
// returned: the claim/order state transitions are the actual dispute
// resolution and must stand regardless — a seller not yet paid out is a
// recoverable, visible problem (retry the transfer), not a reason to leave
// a decided claim in limbo.
func releaseOrder(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, orderID string) error {
	if err := order.Transition(ctx, pool, orderID, order.StateClaimOpen, order.StateReleased); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `update orders set released_at = now() where id = $1`, orderID); err != nil {
		return fmt.Errorf("stamp released_at: %w", err)
	}

	// A real Stripe chargeback (as opposed to the claim this order just
	// resolved) can land on an order at any point, independent of our own
	// dispute ladder — check right before the one Transfer call that would
	// actually pay the seller, so a claim resolving in the seller's favor
	// never pays out on a charge Stripe has already reversed or is still
	// deciding on (internal/chargeback.HasBlockingChargeback).
	if blocked, err := chargeback.HasBlockingChargeback(ctx, pool, orderID); err != nil {
		log.Printf("dispute: failed to check chargeback status for order %s: %v", orderID, err)
	} else if blocked {
		log.Printf("dispute: order %s has a pending or lost chargeback — withholding seller payout", orderID)
		return nil
	}

	if err := order.ReleaseFunds(ctx, pool, paymentClient, orderID); err != nil {
		log.Printf("dispute: failed to release funds for order %s: %v", orderID, err)
	}
	return nil
}

// executeFullRefund refunds the platform-side charge in full — separate
// charges and transfers (docs/Legal_MoneyTransitter.md) means this never
// touches the seller's connected account at all: a full refund is only
// reachable from claim_open -> refunded, and no Transfer to the seller has
// ever happened by that point (Transfers only happen at release,
// internal/order.ReleaseFunds), so there's nothing on the seller's side to
// claw back.
func executeFullRefund(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, o *order.Order) error {
	if !paymentClient.IsConfigured() || o.StripePaymentIntentID == nil {
		return nil
	}
	return paymentClient.Refund(ctx, *o.StripePaymentIntentID)
}

// executePartialRefund refunds part of the platform-side charge and
// records how much on the order itself (orders.refunded_cents) — the
// order still proceeds to released after this (the seller keeps the sale,
// just a reduced one), and internal/order.ReleaseFunds needs this number to
// know the eventual Transfer is seller_net_cents minus whatever's already
// gone back to the buyer, never the full pre-refund amount.
func executePartialRefund(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, o *order.Order, amountCents int64) error {
	if !paymentClient.IsConfigured() || o.StripePaymentIntentID == nil {
		return nil
	}
	if err := paymentClient.RefundAmount(ctx, *o.StripePaymentIntentID, amountCents); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		update orders set refunded_cents = refunded_cents + $1 where id = $2
	`, amountCents, o.ID); err != nil {
		return fmt.Errorf("record refunded amount: %w", err)
	}
	return nil
}

// Appeal files the one allowed appeal against a decided claim (design doc
// v2 §9.1: "one appeal, different reviewer, final") — checked against
// claim_events rather than a dedicated counter column, since the event log
// is already the audit trail for everything else here.
func Appeal(ctx context.Context, pool *pgxpool.Pool, claimID, actorID, body string) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if err := requireParticipant(ctx, pool, c.OrderID, actorID); err != nil {
		return err
	}
	var alreadyAppealed bool
	if err := pool.QueryRow(ctx, `
		select exists(select 1 from claim_events where claim_id = $1 and kind = $2)
	`, claimID, string(EventAppeal)).Scan(&alreadyAppealed); err != nil {
		return fmt.Errorf("check prior appeal: %w", err)
	}
	if alreadyAppealed {
		return ErrAlreadyAppealed
	}
	if err := addEvent(ctx, pool, claimID, actorID, EventAppeal, &body, nil); err != nil {
		return err
	}
	return Transition(ctx, pool, claimID, StateDecided, StateAppealed)
}

// DecideAppeal is the "different reviewer" half of the one-appeal rule —
// design doc v2 doesn't specify a mechanism enforcing the reviewer is
// literally different from the first one; that's a process/staffing
// control, not something this function can verify from the data alone.
// Always lands in closed — final, no further appeals possible from there.
func DecideAppeal(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, claimID, reviewerID string, resolution Resolution, liable LiableParty, refundCents int64) error {
	c, err := Get(ctx, pool, claimID)
	if err != nil {
		return err
	}
	if c.State != StateAppealed {
		return ErrNotUnderReview
	}
	o, err := order.GetByID(ctx, pool, c.OrderID)
	if err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		update claims set resolution = $1, liable_party = $2, refund_cents = $3, reviewer_id = $4
		where id = $5
	`, string(resolution), string(liable), nullableAmount(refundCents), reviewerID, claimID); err != nil {
		return fmt.Errorf("record appeal decision: %w", err)
	}
	body := fmt.Sprintf("appeal decision: resolution=%s liable=%s", resolution, liable)
	if err := addEvent(ctx, pool, claimID, reviewerID, EventDecision, &body, nil); err != nil {
		return err
	}
	if err := Transition(ctx, pool, claimID, StateAppealed, StateClosed); err != nil {
		return err
	}

	switch resolution {
	case ResolutionRefundBuyer, ResolutionPlatformAbsorb:
		if err := executeFullRefund(ctx, pool, paymentClient, o); err != nil {
			return err
		}
	case ResolutionPartialRefund:
		if err := executePartialRefund(ctx, pool, paymentClient, o, refundCents); err != nil {
			return err
		}
	}
	// Order state was already settled by the original decision (Decide) —
	// an appeal can change who's liable/whether a partial refund applies,
	// but the order itself is already refunded/released by this point, so
	// there's no further order.Transition to make here.
	return nil
}

func nullableAmount(cents int64) *int64 {
	if cents == 0 {
		return nil
	}
	return &cents
}

func ptr(s string) *string { return &s }
