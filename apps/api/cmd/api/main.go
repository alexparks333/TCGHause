// Command api is the HTTP + WebSocket entrypoint for the AuctionHous - TCG
// backend. It currently exposes a health check and, once Supabase is
// configured, a /me endpoint proving the auth pipeline end to end. Wire up
// the rest of the internal/ packages here as they gain real handlers.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/joho/godotenv"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/auction"
	"auctionhous-tcg/api/internal/feedback"
	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
	"auctionhous-tcg/api/internal/watchlist"
)

func main() {
	// Best-effort: in production real env vars are set directly and no
	// .env file exists, which is fine — godotenv.Load returning an error
	// there is expected, not fatal.
	_ = godotenv.Load()

	cfg, err := platform.LoadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	listing.AllowDevDurations = cfg.Environment != "production"

	ctx := context.Background()
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealthz)

	if cfg.SupabaseURL == "" {
		log.Println("SUPABASE_URL not set — /me disabled until a Supabase project is configured (see apps/api/.env.example)")
	} else {
		pool, err := platform.NewPgxPool(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("db pool: %v", err)
		}
		defer pool.Close()

		verifier, err := platform.NewAuthVerifier(ctx, cfg.SupabaseURL+"/auth/v1/.well-known/jwks.json")
		if err != nil {
			log.Fatalf("auth verifier: %v", err)
		}

		mux.Handle("/me", verifier.RequireAuth(user.HandleMe(pool)))
		mux.Handle("POST /me/username", verifier.RequireAuth(user.HandleSetUsername(pool)))
		mux.Handle("POST /me/bio", verifier.RequireAuth(user.HandleSetBio(pool)))
		mux.Handle("GET /me/address", verifier.RequireAuth(address.HandleGet(pool)))
		mux.Handle("POST /me/address", verifier.RequireAuth(address.HandleUpsert(pool)))
		mux.HandleFunc("GET /usernames/available", user.HandleUsernameAvailable(pool))
		mux.HandleFunc("GET /users/{username}", user.HandleGetByUsername(pool))
		mux.HandleFunc("GET /users/{username}/reviews", feedback.HandleListForSeller(pool))
		mux.Handle("POST /users/{username}/reviews", verifier.RequireAuth(feedback.HandleUpsert(pool)))
		mux.Handle("GET /users/{username}/can-review", verifier.RequireAuth(feedback.HandleCanReview(pool)))

		mux.Handle("POST /listings", verifier.RequireAuth(listing.HandleCreate(pool)))
		mux.HandleFunc("GET /listings", listing.HandleList(pool))
		mux.HandleFunc("GET /listings/counts", listing.HandleCounts(pool))
		mux.HandleFunc("GET /listings/{id}", listing.HandleGet(pool))
		mux.Handle("POST /listings/{id}/bids", verifier.RequireAuth(auction.HandlePlaceBid(pool)))
		mux.Handle("/me/bids", verifier.RequireAuth(auction.HandleMyBids(pool)))

		mux.Handle("GET /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleGetStatus(pool)))
		mux.Handle("POST /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleAdd(pool)))
		mux.Handle("DELETE /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleRemove(pool)))
		mux.Handle("/me/watchlist", verifier.RequireAuth(watchlist.HandleMyWatchlist(pool)))
	}

	log.Printf("api listening on :%s (CORS allowing %s)", cfg.Port, cfg.WebOrigin)
	if err := http.ListenAndServe(":"+cfg.Port, platform.WithCORS(cfg.WebOrigin, mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
