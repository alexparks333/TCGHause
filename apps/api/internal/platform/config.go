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
	// StripeSecretKey is a TEST-mode secret key (sk_test_...) for the Buy
	// It Now checkout flow (internal/payment). Empty until a Stripe
	// account exists — same graceful-degradation pattern as
	// SupabaseURL: cmd/api skips registering the real-payment checkout
	// route and internal/auction.HandleBuyNow falls back to its original
	// no-payment mock path instead of failing to boot. This is
	// deliberately test-mode only for now — see CLAUDE.md §5.1/§7 on why
	// real (live-mode) payment collection is a separate, legal-gated step.
	StripeSecretKey string
	// StripeWebhookSecret (whsec_...) verifies the Stripe-Signature header
	// on incoming /webhooks/stripe requests (internal/webhook) — without
	// it, the webhook route isn't registered at all, same graceful-
	// degradation pattern as StripeSecretKey/SupabaseURL. Get it from the
	// Stripe CLI (`stripe listen`) for local dev, or the dashboard's
	// webhook endpoint settings once deployed.
	StripeWebhookSecret string
	// CarrierWebhookSecret gates POST /webhooks/carrier (internal/shipping)
	// — an HMAC-SHA256 shared secret, not a real carrier vendor's signature
	// scheme (see internal/shipping/webhook.go's doc comment on why: no
	// Shippo/EasyPost account exists yet to integrate against for real).
	// Empty skips registering the route, same graceful-degradation pattern
	// as the Stripe keys.
	CarrierWebhookSecret string
	// AdminEmails is a comma-separated allowlist gating the claims human-
	// review endpoints (internal/dispute) — the minimal, no-real-admin-app
	// stand-in the plan explicitly flagged: "no admin surface exists
	// anywhere in this repo today." Empty means nobody can reach those
	// routes, not that they're open — see RequireAdmin.
	AdminEmails string
	// CardCatalogProjectID is TCG Haven's Firebase/GCP project ID
	// (internal/cardcatalog reads its Firestore catalog, read-only, to
	// power the Sell wizard's card autofill). Empty until the read-only
	// service account is provisioned — same graceful-degradation pattern
	// as SupabaseURL: GET /catalog/search just isn't registered.
	CardCatalogProjectID string
	// CardCatalogCredentialsFile is the path to the read-only service
	// account's JSON key (roles/datastore.viewer on TCG Haven's project —
	// never the write-capable "sync" account TCG Haven's own bulk-ingest
	// script uses). Gitignored; never commit this file.
	CardCatalogCredentialsFile string
	// SupabaseServiceRoleKey is meaningfully more powerful than every other
	// secret in this file: it bypasses Row Level Security for the ENTIRE
	// Supabase project, not just one table or bucket. Used exactly once
	// today — internal/photosession's server-side Storage write, needed
	// because that flow's phone client is deliberately never logged in and
	// so can't satisfy the normal auth.uid()-based RLS policy. Server-side
	// only, gitignored, must never reach the frontend. Empty means
	// POST /photo-sessions/{id}/photos just isn't registered — same
	// graceful-degradation pattern as every other optional integration
	// here.
	SupabaseServiceRoleKey string
}

// LoadConfig reads configuration from the environment, applying sane local
// defaults so `go run ./cmd/api` works against the infra/docker-compose.yml
// stack without any .env file.
func LoadConfig() (Config, error) {
	cfg := Config{
		Port:                       getEnv("PORT", "8080"),
		DatabaseURL:                getEnv("DATABASE_URL", "postgres://auctionhous:auctionhous@localhost:5432/auctionhous?sslmode=disable"),
		RedisURL:                   getEnv("REDIS_URL", "redis://localhost:6379/0"),
		SupabaseURL:                getEnv("SUPABASE_URL", ""),
		WebOrigin:                  getEnv("WEB_ORIGIN", "http://localhost:4000"),
		Environment:                getEnv("APP_ENV", "development"),
		StripeSecretKey:            getEnv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret:        getEnv("STRIPE_WEBHOOK_SECRET", ""),
		CarrierWebhookSecret:       getEnv("CARRIER_WEBHOOK_SECRET", ""),
		AdminEmails:                getEnv("ADMIN_EMAILS", ""),
		CardCatalogProjectID:       getEnv("CARD_CATALOG_PROJECT_ID", ""),
		CardCatalogCredentialsFile: getEnv("CARD_CATALOG_CREDENTIALS_FILE", ""),
		SupabaseServiceRoleKey:     getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
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
