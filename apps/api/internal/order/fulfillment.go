package order

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/seller"
)

// EvidenceType is one of order_evidence.type's six values (migration 0024).
type EvidenceType string

const (
	EvidenceTrackingNumber EvidenceType = "tracking_number"
	EvidenceCardFront      EvidenceType = "card_front"
	EvidenceCardBack       EvidenceType = "card_back"
	EvidencePackageSealed  EvidenceType = "package_sealed"
	EvidenceArrivalPhoto   EvidenceType = "arrival_photo"
	EvidenceClaimPhoto     EvidenceType = "claim_photo"
)

// requiredForShip is design doc v2 §5.3's blocking list: SHIPPED is
// unreachable without a validated tracking number and photos of the card
// (front/back) and the sealed package. tracking_number itself is
// intentionally excluded here — MarkShipped records it as its own evidence
// row paired with the actual carrier/trackingNumber fields, it's never
// uploaded separately by the client the way the three photos are.
var requiredForShip = []EvidenceType{EvidenceCardFront, EvidenceCardBack, EvidencePackageSealed}

var (
	ErrNotParticipant      = errors.New("order: caller is not a participant in this order")
	ErrEvidenceIncomplete  = errors.New("order: required shipping evidence is missing")
	ErrNotSeller           = errors.New("order: only the seller can do this")
	ErrUnknownEvidenceType = errors.New("order: unknown evidence type")
)

// AddEvidence records one evidence row after the caller has already
// uploaded the file client-side (Supabase Storage, same pattern as listing
// photos — url is already a public URL by the time this runs). Enforces
// who's allowed to upload which type: sellers provide the shipping-proof
// photos, buyers provide the arrival photo — nobody uploads on someone
// else's behalf, and tracking_number can never be uploaded this way at all
// (see MarkShipped, which is the only writer of that type).
func AddEvidence(ctx context.Context, pool *pgxpool.Pool, orderID, uploaderID string, evidenceType EvidenceType, url string) error {
	var buyerID, sellerID string
	if err := pool.QueryRow(ctx, `select buyer_id, seller_id from orders where id = $1`, orderID).Scan(&buyerID, &sellerID); err != nil {
		return fmt.Errorf("read order participants: %w", err)
	}

	switch evidenceType {
	case EvidenceCardFront, EvidenceCardBack, EvidencePackageSealed:
		if uploaderID != sellerID {
			return ErrNotParticipant
		}
	case EvidenceArrivalPhoto, EvidenceClaimPhoto:
		if uploaderID != buyerID {
			return ErrNotParticipant
		}
	case EvidenceTrackingNumber:
		return fmt.Errorf("%w: tracking_number is recorded via MarkShipped, not uploaded directly", ErrUnknownEvidenceType)
	default:
		return fmt.Errorf("%w: %q", ErrUnknownEvidenceType, evidenceType)
	}

	if _, err := pool.Exec(ctx, `
		insert into order_evidence (order_id, uploaded_by, type, url) values ($1, $2, $3, $4)
	`, orderID, uploaderID, string(evidenceType), url); err != nil {
		return fmt.Errorf("insert evidence: %w", err)
	}
	return nil
}

// CanTransitionToShipped reports whether orderID has every evidence type
// design doc v2 §5.3 requires — a literal precondition function, not a
// judgment call.
func CanTransitionToShipped(ctx context.Context, pool *pgxpool.Pool, orderID string) (ok bool, missing []EvidenceType, err error) {
	rows, err := pool.Query(ctx, `select type from order_evidence where order_id = $1`, orderID)
	if err != nil {
		return false, nil, fmt.Errorf("query evidence: %w", err)
	}
	defer rows.Close()

	have := map[EvidenceType]bool{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return false, nil, fmt.Errorf("scan evidence: %w", err)
		}
		have[EvidenceType(t)] = true
	}
	if err := rows.Err(); err != nil {
		return false, nil, err
	}

	for _, req := range requiredForShip {
		if !have[req] {
			missing = append(missing, req)
		}
	}
	return len(missing) == 0, missing, nil
}

// MarkShipped is the seller's "mark as shipped" action: validates the
// required photo evidence already exists, records the tracking
// number/carrier as their own evidence row and on the order itself, and
// transitions awaiting_ship -> shipped. sellerID must be the order's actual
// seller — never trust a client-supplied claim of who's fulfilling an
// order (CLAUDE.md §5.3).
func MarkShipped(ctx context.Context, pool *pgxpool.Pool, orderID, sellerID, carrier, trackingNumber string) error {
	var actualSellerID string
	if err := pool.QueryRow(ctx, `select seller_id from orders where id = $1`, orderID).Scan(&actualSellerID); err != nil {
		return fmt.Errorf("read order seller: %w", err)
	}
	if sellerID != actualSellerID {
		return ErrNotSeller
	}

	ok, _, err := CanTransitionToShipped(ctx, pool, orderID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrEvidenceIncomplete
	}

	if _, err := pool.Exec(ctx, `
		insert into order_evidence (order_id, uploaded_by, type, url) values ($1, $2, $3, $4)
	`, orderID, sellerID, string(EvidenceTrackingNumber), trackingNumber); err != nil {
		return fmt.Errorf("record tracking evidence: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		update orders set tracking_number = $1, carrier = $2 where id = $3
	`, trackingNumber, carrier, orderID); err != nil {
		return fmt.Errorf("record tracking on order: %w", err)
	}

	return Transition(ctx, pool, orderID, StateAwaitingShip, StateShipped)
}

// highValueThresholdCents is design doc v2 §5.2's $250 cutoff between the
// 3-day and 7-day claim window.
const highValueThresholdCents = 25000

// MarkDelivered processes a carrier "delivered" scan: transitions
// shipped -> delivered, then immediately delivered -> claim_window (design
// doc v2 §5.2 lists that second hop as "auto" — no reason to wait for a
// separate timer tick once delivery is confirmed), setting claim_deadline
// to now + 3 days (orders under $250) or + 7 days ($250 and up).
// Trusted-release — Gold/Haus Trust sellers skipping the claim window
// entirely — is Phase 7 scope, once the tier engine exists to know who
// actually qualifies; every seller gets the standard window for now.
func MarkDelivered(ctx context.Context, pool *pgxpool.Pool, orderID string) error {
	if _, err := pool.Exec(ctx, `update orders set delivered_at = now() where id = $1`, orderID); err != nil {
		return fmt.Errorf("record delivered_at: %w", err)
	}
	if err := Transition(ctx, pool, orderID, StateShipped, StateDelivered); err != nil {
		return err
	}

	var sellerID string
	var chargedCents int64
	if err := pool.QueryRow(ctx, `
		select seller_id, charged_cents from orders where id = $1
	`, orderID).Scan(&sellerID, &chargedCents); err != nil {
		return fmt.Errorf("read order: %w", err)
	}

	// Trusted release (design doc v2 §6.4): Gold/Haus Trust sellers skip
	// the claim window entirely, releasing the instant delivery is
	// confirmed — a concrete, felt benefit of reaching the top tiers, not
	// just a lower commission rate.
	tier, err := seller.CurrentTier(ctx, pool, sellerID)
	if err != nil {
		return fmt.Errorf("read seller tier: %w", err)
	}
	if tier == seller.TierGold || tier == seller.TierHausTrust {
		if err := Transition(ctx, pool, orderID, StateDelivered, StateReleased); err != nil {
			return err
		}
		_, err := pool.Exec(ctx, `update orders set released_at = now() where id = $1`, orderID)
		return err
	}

	window := 3 * 24 * time.Hour
	if chargedCents >= highValueThresholdCents {
		window = 7 * 24 * time.Hour
	}
	if _, err := pool.Exec(ctx, `
		update orders set claim_deadline = now() + $1 where id = $2
	`, window, orderID); err != nil {
		return fmt.Errorf("set claim deadline: %w", err)
	}

	return Transition(ctx, pool, orderID, StateDelivered, StateClaimWindow)
}
