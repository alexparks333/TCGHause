package dispute

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("claim not found")

type Claim struct {
	ID string `json:"id"`
	// TicketNo is a plain sequential number (bigserial); TicketNumber is the
	// "CLM-000123" display form the frontend actually shows — computed here,
	// not stored, so the format can change without a migration.
	TicketNo     int64        `json:"ticketNo"`
	TicketNumber string       `json:"ticketNumber"`
	OrderID      string       `json:"orderId"`
	OpenedBy     string       `json:"openedBy"`
	ReasonCode   ReasonCode   `json:"reasonCode"`
	State        State        `json:"state"`
	Resolution   *Resolution  `json:"resolution,omitempty"`
	RefundCents  *int64       `json:"refundCents,omitempty"`
	LiableParty  *LiableParty `json:"liableParty,omitempty"`
	ReviewerID   *string      `json:"reviewerId,omitempty"`
	CreatedAt    time.Time    `json:"createdAt"`
	ResolvedAt   *time.Time   `json:"resolvedAt,omitempty"`
}

type EventKind string

const (
	EventMessage            EventKind = "message"
	EventEvidence           EventKind = "evidence"
	EventPartialRefundOffer EventKind = "partial_refund_offer"
	EventEscalation         EventKind = "escalation"
	EventDecision           EventKind = "decision"
	EventAppeal             EventKind = "appeal"
)

type Event struct {
	ID          string    `json:"id"`
	ClaimID     string    `json:"claimId"`
	ActorID     string    `json:"actorId"`
	Kind        EventKind `json:"kind"`
	Body        *string   `json:"body,omitempty"`
	AmountCents *int64    `json:"amountCents,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

func Get(ctx context.Context, pool *pgxpool.Pool, claimID string) (*Claim, error) {
	var c Claim
	err := pool.QueryRow(ctx, `
		select id, ticket_no, order_id, opened_by, reason_code, state, resolution, refund_cents,
			liable_party, reviewer_id, created_at, resolved_at
		from claims where id = $1
	`, claimID).Scan(
		&c.ID, &c.TicketNo, &c.OrderID, &c.OpenedBy, &c.ReasonCode, &c.State, &c.Resolution, &c.RefundCents,
		&c.LiableParty, &c.ReviewerID, &c.CreatedAt, &c.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query claim: %w", err)
	}
	c.TicketNumber = formatTicketNumber(c.TicketNo)
	return &c, nil
}

// formatTicketNumber renders a claim's sequential id as the "CLM-000123"
// form shown throughout the UI and (eventually) in claim-related emails.
func formatTicketNumber(ticketNo int64) string {
	return fmt.Sprintf("CLM-%06d", ticketNo)
}

// GetForOrder returns the (at most one, in practice — a second claim on an
// already-claimed order isn't a flow this package exposes) claim tied to
// orderID, most recent first.
func GetForOrder(ctx context.Context, pool *pgxpool.Pool, orderID string) (*Claim, error) {
	var c Claim
	err := pool.QueryRow(ctx, `
		select id, ticket_no, order_id, opened_by, reason_code, state, resolution, refund_cents,
			liable_party, reviewer_id, created_at, resolved_at
		from claims where order_id = $1
		order by created_at desc limit 1
	`, orderID).Scan(
		&c.ID, &c.TicketNo, &c.OrderID, &c.OpenedBy, &c.ReasonCode, &c.State, &c.Resolution, &c.RefundCents,
		&c.LiableParty, &c.ReviewerID, &c.CreatedAt, &c.ResolvedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query claim for order: %w", err)
	}
	c.TicketNumber = formatTicketNumber(c.TicketNo)
	return &c, nil
}

func Events(ctx context.Context, pool *pgxpool.Pool, claimID string) ([]Event, error) {
	rows, err := pool.Query(ctx, `
		select id, claim_id, actor_id, kind, body, amount_cents, created_at
		from claim_events where claim_id = $1 order by created_at asc
	`, claimID)
	if err != nil {
		return nil, fmt.Errorf("query claim events: %w", err)
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.ClaimID, &e.ActorID, &e.Kind, &e.Body, &e.AmountCents, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan claim event: %w", err)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
