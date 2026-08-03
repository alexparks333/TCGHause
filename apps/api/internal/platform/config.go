// Package platform holds cross-cutting infrastructure: config loading, auth
// middleware, telemetry, and idempotency-key handling shared by every other
// internal package.
package platform

import (
	"fmt"
	"os"
)

// Config holds process-wide settings loaded from the environment. Every
// entrypoint (cmd/api, cmd/worker, cmd/migrate) should load one of these at
// startup rather than reading os.Getenv scattered through business logic.
type Config struct {
	Port        string
	DatabaseURL string
	RedisURL    string
	// SupabaseURL is the project's base URL (e.g. https://xyzcompany.supabase.co).
	// Empty until a Supabase project has been created — callers must check
	// for that before relying on JWT verification being available.
	SupabaseURL string
	// WebOrigin is the frontend's origin, allowed via CORS so browser JS on
	// apps/web can call this API directly. Only one origin for now — revisit
	// if a second frontend (e.g. the v2 mobile app, CLAUDE.md §2) ever needs one.
	WebOrigin string
	// Environment gates dev-only affordances (currently: short auction
	// durations for testing the bidding engine, CLAUDE.md §6.1). Defaults to
	// "development" — there's no deployed production environment yet, so an
	// explicit APP_ENV=production is what turns these off, mirroring how
	// apps/web's NODE_ENV defaults to "development" under `next dev`.
	Environment string
}

// LoadConfig reads configuration from the environment, applying sane local
// defaults so `go run ./cmd/api` works against the infra/docker-compose.yml
// stack without any .env file.
func LoadConfig() (Config, error) {
	cfg := Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://auctionhous:auctionhous@localhost:5432/auctionhous?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", "redis://localhost:6379/0"),
		SupabaseURL: getEnv("SUPABASE_URL", ""),
		WebOrigin:   getEnv("WEB_ORIGIN", "http://localhost:4000"),
		Environment: getEnv("APP_ENV", "development"),
	}
	if cfg.Port == "" {
		return Config{}, fmt.Errorf("PORT must not be empty")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
