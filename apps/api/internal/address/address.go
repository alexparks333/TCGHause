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

// Address is both the domain model and the JSON shape. Line2 is the only
// optional field — Phone was optional originally, but Shippo's label
// purchase (internal/shipping) rejects any shipment missing a phone number
// on either address, discovered live once real label purchase went in, so
// Upsert below now requires it too rather than letting a seller find out
// only when they try to buy a label.
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

// usCountryVariants are the free-text spellings of "United States" a real
// person types into a plain text Country field (AddressForm.tsx has no
// dropdown/autocomplete) — found live: a real dev-account address stored
// "USA", which Shippo silently tolerated but Pitney Bowes' Shipping 360
// API rejected outright ("invalid originCountryCode, it should be valid 2
// characters ISO code"). Scoped to US-only variants because the app itself
// is domestic-only in v1 (CLAUDE.md §6.11) — this isn't a general
// country-name-to-ISO-code table, just closing the one gap that made two
// vendors disagree on the same stored address.
var usCountryVariants = map[string]bool{
	"usa":                      true,
	"us":                       true,
	"u.s.":                     true,
	"u.s.a.":                   true,
	"united states":            true,
	"united states of america": true,
}

// Normalize maps free-text country spellings to the ISO 3166-1 alpha-2
// code every shipping vendor actually requires, and trims the rest of the
// fields. Called before Validate on every write path (Upsert, and
// internal/shipping.HandleBuyLabel's one-time from-address override) so
// neither Shippo nor Pitney Bowes ever sees an address this permissive
// free-text field let through un-normalized.
func Normalize(a Address) Address {
	a.FullName = strings.TrimSpace(a.FullName)
	a.Line1 = strings.TrimSpace(a.Line1)
	if a.Line2 != nil {
		trimmed := strings.TrimSpace(*a.Line2)
		a.Line2 = &trimmed
	}
	a.City = strings.TrimSpace(a.City)
	a.State = strings.TrimSpace(a.State)
	a.PostalCode = strings.TrimSpace(a.PostalCode)
	if usCountryVariants[strings.ToLower(strings.TrimSpace(a.Country))] {
		a.Country = "US"
	} else {
		a.Country = strings.TrimSpace(a.Country)
	}
	if a.Phone != nil {
		trimmed := strings.TrimSpace(*a.Phone)
		a.Phone = &trimmed
	}
	return a
}

// Validate reports whether a is complete enough to ship or mail with —
// every field but Line2 required, Phone included (Shippo's label purchase
// rejects any shipment missing a phone number on either address, see
// Address's own doc comment). Shared by Upsert and by
// internal/shipping.HandleBuyLabel's per-order from-address override,
// which never goes through Upsert (that override is a one-time
// substitution for a single label purchase, deliberately never written to
// this package's own table — see that handler's doc comment).
func Validate(a Address) error {
	if strings.TrimSpace(a.FullName) == "" ||
		strings.TrimSpace(a.Line1) == "" ||
		strings.TrimSpace(a.City) == "" ||
		strings.TrimSpace(a.State) == "" ||
		strings.TrimSpace(a.PostalCode) == "" ||
		strings.TrimSpace(a.Country) == "" ||
		a.Phone == nil || strings.TrimSpace(*a.Phone) == "" {
		return ErrInvalidInput
	}
	return nil
}

// Upsert saves userID's address, replacing whatever was there before — an
// address has no history to preserve, unlike a review or a listing.
func Upsert(ctx context.Context, pool *pgxpool.Pool, userID string, in Address) (*Address, error) {
	in = Normalize(in)
	if err := Validate(in); err != nil {
		return nil, err
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
