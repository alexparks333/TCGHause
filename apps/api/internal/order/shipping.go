package order

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SetLabel persists the result of a real carrier label purchase
// (internal/shipping.HandleBuyLabel) onto an order — deliberately a plain
// column write, not a state transition: buying a label doesn't move the
// order past awaiting_ship on its own, MarkShipped (still gated on the
// design doc v2 §5.3 photo evidence) does that, using the carrier/tracking
// number this call just recorded. sellerID must be the order's actual
// seller, same "never trust a client-supplied claim of who's fulfilling an
// order" rule as MarkShipped (CLAUDE.md §5.3).
func SetLabel(ctx context.Context, pool *pgxpool.Pool, orderID, sellerID, carrier, trackingNumber, easypostShipmentID, labelURL string, labelCostCents int64) error {
	var actualSellerID string
	if err := pool.QueryRow(ctx, `select seller_id from orders where id = $1`, orderID).Scan(&actualSellerID); err != nil {
		return fmt.Errorf("read order seller: %w", err)
	}
	if sellerID != actualSellerID {
		return ErrNotSeller
	}

	if _, err := pool.Exec(ctx, `
		update orders set
			tracking_number = $1, carrier = $2,
			easypost_shipment_id = $3, label_cost_cents = $4, label_url = $5
		where id = $6
	`, trackingNumber, carrier, easypostShipmentID, labelCostCents, labelURL, orderID); err != nil {
		return fmt.Errorf("record shipping label: %w", err)
	}
	return nil
}
