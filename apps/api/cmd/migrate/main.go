// Command migrate applies SQL migrations from apps/api/migrations against
// DATABASE_URL, tracking applied versions in a schema_migrations table so
// re-running it is a no-op once everything is applied. Run from apps/api:
//
//	go run ./cmd/migrate
package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/joho/godotenv"

	"auctionhous-tcg/api/internal/platform"
)

func main() {
	_ = godotenv.Load()

	cfg, err := platform.LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
	conn, err := platform.NewPgxPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Exec(ctx, `
		create table if not exists schema_migrations (
			version text primary key,
			applied_at timestamptz not null default now()
		)
	`); err != nil {
		log.Fatalf("ensure schema_migrations table: %v", err)
	}

	migrationsDir := "migrations"
	if len(os.Args) > 1 {
		migrationsDir = os.Args[1]
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		log.Fatalf("read migrations dir %s: %v", migrationsDir, err)
	}

	var upFiles []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".up.sql") {
			upFiles = append(upFiles, e.Name())
		}
	}
	sort.Strings(upFiles)

	applied := 0
	for _, name := range upFiles {
		version := strings.TrimSuffix(name, ".up.sql")

		var alreadyApplied bool
		err := conn.QueryRow(ctx,
			`select exists(select 1 from schema_migrations where version = $1)`, version,
		).Scan(&alreadyApplied)
		if err != nil {
			log.Fatalf("check %s: %v", version, err)
		}
		if alreadyApplied {
			log.Printf("skip %s (already applied)", version)
			continue
		}

		sqlBytes, err := os.ReadFile(filepath.Join(migrationsDir, name))
		if err != nil {
			log.Fatalf("read %s: %v", name, err)
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			log.Fatalf("begin tx for %s: %v", version, err)
		}

		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			log.Fatalf("apply %s: %v", version, err)
		}
		if _, err := tx.Exec(ctx,
			`insert into schema_migrations (version) values ($1)`, version,
		); err != nil {
			_ = tx.Rollback(ctx)
			log.Fatalf("record %s: %v", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			log.Fatalf("commit %s: %v", version, err)
		}

		log.Printf("applied %s", version)
		applied++
	}

	log.Printf("done — %d migration(s) applied, %d already up to date", applied, len(upFiles)-applied)
}
