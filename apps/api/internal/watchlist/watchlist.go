// Package watchlist implements real watch counts and per-user watch state
// — the "23 Watchers" badge on a listing's detail page. No fabricated
// numbers: Count is always a live query, never a stored/cached guess.
package watchlist

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Count(ctx context.Context, pool *pgxpool.Pool, listingID string) (int, error) {
	var count int
	err := pool.QueryRow(ctx,
		`select count(*) from watchlist where listing_id = $1`, listingID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count watchers: %w", err)
	}
	return count, nil
}

func IsWatching(ctx context.Context, pool *pgxpool.Pool, userID, listingID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx,
		`select exists(select 1 from watchlist where user_id = $1 and listing_id = $2)`,
		userID, listingID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check watching: %w", err)
	}
	return exists, nil
}

func Add(ctx context.Context, pool *pgxpool.Pool, userID, listingID string) error {
	_, err := pool.Exec(ctx, `
		insert into watchlist (user_id, listing_id) values ($1, $2)
		on conflict (user_id, listing_id) do nothing
	`, userID, listingID)
	if err != nil {
		return fmt.Errorf("add watch: %w", err)
	}
	return nil
}

func Remove(ctx context.Context, pool *pgxpool.Pool, userID, listingID string) error {
	_, err := pool.Exec(ctx,
		`delete from watchlist where user_id = $1 and listing_id = $2`,
		userID, listingID,
	)
	if err != nil {
		return fmt.Errorf("remove watch: %w", err)
	}
	return nil
}

// MyWatchedListingIDs lets a page batch-initialize every listing card's
// heart in one query, instead of each ListingCard fetching its own status
// client-side (which is both N+1 and reintroduces the same client-side
// race that caused the original "watching doesn't save" bug).
//
// Scoped to l.status = 'active' — a watch row itself is never deleted just
// because a listing stopped being active (its watcherCount stays a real
// historical fact, e.g. on a sold listing's own page), but nothing that's
// no longer for sale — ended, sold, or manually cancelled — should keep
// showing up on the Watchlist page or anywhere else this drives a heart
// icon's initial state.
func MyWatchedListingIDs(ctx context.Context, pool *pgxpool.Pool, userID string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		select w.listing_id
		from watchlist w
		join listings l on l.id = w.listing_id
		where w.user_id = $1 and l.status = 'active'
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query my watchlist: %w", err)
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan watched id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
