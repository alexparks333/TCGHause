package platform

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPgxPool builds a connection pool with prepared-statement caching
// disabled. Supabase's transaction-mode pooler (PgBouncer on port 6543)
// can route each query to a different backend connection, so a statement
// prepared on one backend may not exist on the next one — simple protocol
// mode sends every query as a plain string instead of a cached prepared
// statement, which is what makes that safe. See CLAUDE.md §6.12.
func NewPgxPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return pgxpool.NewWithConfig(ctx, poolConfig)
}
