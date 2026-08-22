package dispute

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminClaimSummary is one row of the admin claims queue — a Claim plus
// exactly the order/listing/participant context a reviewer needs to work
// it without a second round trip per claim, same "denormalize the list
// view" shape as order.Summary (CLAUDE.md §6.13-adjacent convention).
type AdminClaimSummary struct {
	Claim
	OrderState     string `json:"orderState"`
	ChargedCents   int64  `json:"chargedCents"`
	ListingTitle   string `json:"listingTitle"`
	BuyerUsername  string `json:"buyerUsername"`
	SellerUsername string `json:"sellerUsername"`
}

const adminClaimSelect = `
	select c.id, c.ticket_no, c.order_id, c.opened_by, c.reason_code, c.state, c.resolution, c.refund_cents,
		c.liable_party, c.reviewer_id, c.created_at, c.resolved_at,
		o.state, o.charged_cents, l.title, bu.username, su.username
	from claims c
	join orders o on o.id = c.order_id
	join order_items oi on oi.order_id = o.id
	join listings l on l.id = oi.listing_id
	join users bu on bu.id = o.buyer_id
	join users su on su.id = o.seller_id
`

func scanAdminClaimSummary(row pgx.Row) (*AdminClaimSummary, error) {
	var s AdminClaimSummary
	c := &s.Claim
	var buyerUsername, sellerUsername *string
	if err := row.Scan(
		&c.ID, &c.TicketNo, &c.OrderID, &c.OpenedBy, &c.ReasonCode, &c.State, &c.Resolution, &c.RefundCents,
		&c.LiableParty, &c.ReviewerID, &c.CreatedAt, &c.ResolvedAt,
		&s.OrderState, &s.ChargedCents, &s.ListingTitle, &buyerUsername, &sellerUsername,
	); err != nil {
		return nil, fmt.Errorf("scan admin claim summary: %w", err)
	}
	c.TicketNumber = formatTicketNumber(c.TicketNo)
	if buyerUsername != nil {
		s.BuyerUsername = *buyerUsername
	}
	if sellerUsername != nil {
		s.SellerUsername = *sellerUsername
	}
	return &s, nil
}

// ListForAdmin returns every claim, most recent first, optionally narrowed
// to one state — the admin claims queue's one query. stateFilter == ""
// returns everything; the queue page itself decides which states actually
// need a reviewer's attention (human_review, appealed) versus which are
// just useful history (negotiating, closed, ...).
func ListForAdmin(ctx context.Context, pool *pgxpool.Pool, stateFilter string) ([]AdminClaimSummary, error) {
	rows, err := pool.Query(ctx, adminClaimSelect+` where ($1 = '' or c.state = $1) order by c.created_at desc`, stateFilter)
	if err != nil {
		return nil, fmt.Errorf("query admin claims: %w", err)
	}
	defer rows.Close()

	out := []AdminClaimSummary{}
	for rows.Next() {
		s, err := scanAdminClaimSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// GetForAdmin is ListForAdmin's single-row form, backing the claim detail
// and decide screen — same joined shape, keyed by claim id. Unlike Get, this
// is not participant-gated (see requireParticipant) — an admin reviewing a
// claim is neither the buyer nor the seller, by design.
func GetForAdmin(ctx context.Context, pool *pgxpool.Pool, claimID string) (*AdminClaimSummary, error) {
	s, err := scanAdminClaimSummary(pool.QueryRow(ctx, adminClaimSelect+` where c.id = $1`, claimID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s, nil
}
