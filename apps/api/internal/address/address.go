// Package address stores one address per user — used both directions:
// ship-to when buying, ship-from when selling. Plain PII, not a payment
// instrument, so ordinary Postgres storage (behind the same deny-by-default
// RLS posture as every other app-owned table) is the right bar here.
// Deliberately does not touch bank/payout details — those must never be
// stored directly (Stripe Connect vaulting only, once legal review clears
// the wallet rebuild — CLAUDE.md §5.1/§7), and are out of scope entirely.
package address

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound     = errors.New("no address on file")
	ErrInvalidInput = errors.New("missing required address fields")
)

// Address is both the domain model and the JSON shape. Line2 and Phone are
// the only optional fields.
type Address struct {
	FullName   string  `json:"fullName"`
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	State      string  `json:"state"`
	PostalCode string  `json:"postalCode"`
	Country    string  `json:"country"`
	Phone      *string `json:"phone"`
	UpdatedAt  string  `json:"updatedAt"`
}

func Get(ctx context.Context, pool *pgxpool.Pool, userID string) (*Address, error) {
	var a Address
	var updatedAt time.Time
	err := pool.QueryRow(ctx, `
		select full_name, line1, line2, city, state, postal_code, country, phone, updated_at
		from addresses where user_id = $1
	`, userID).Scan(
		&a.FullName, &a.Line1, &a.Line2, &a.City, &a.State, &a.PostalCode, &a.Country, &a.Phone, &updatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query address: %w", err)
	}
	a.UpdatedAt = updatedAt.Format(time.RFC3339)
	return &a, nil
}

// Upsert saves userID's address, replacing whatever was there before — an
// address has no history to preserve, unlike a review or a listing.
func Upsert(ctx context.Context, pool *pgxpool.Pool, userID string, in Address) (*Address, error) {
	if strings.TrimSpace(in.FullName) == "" ||
		strings.TrimSpace(in.Line1) == "" ||
		strings.TrimSpace(in.City) == "" ||
		strings.TrimSpace(in.State) == "" ||
		strings.TrimSpace(in.PostalCode) == "" ||
		strings.TrimSpace(in.Country) == "" {
		return nil, ErrInvalidInput
	}

	_, err := pool.Exec(ctx, `
		insert into addresses (user_id, full_name, line1, line2, city, state, postal_code, country, phone, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		on conflict (user_id) do update set
			full_name = excluded.full_name,
			line1 = excluded.line1,
			line2 = excluded.line2,
			city = excluded.city,
			state = excluded.state,
			postal_code = excluded.postal_code,
			country = excluded.country,
			phone = excluded.phone,
			updated_at = now()
	`, userID, in.FullName, in.Line1, in.Line2, in.City, in.State, in.PostalCode, in.Country, in.Phone)
	if err != nil {
		return nil, fmt.Errorf("upsert address: %w", err)
	}
	return Get(ctx, pool, userID)
}
