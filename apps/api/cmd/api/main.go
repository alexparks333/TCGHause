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
	"auctionhous-tcg/api/internal/buyerreview"
	"auctionhous-tcg/api/internal/cardcatalog"
	"auctionhous-tcg/api/internal/dispute"
	"auctionhous-tcg/api/internal/feedback"
	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/mail"
	"auctionhous-tcg/api/internal/message"
	"auctionhous-tcg/api/internal/metrics"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/paymentmethod"
	"auctionhous-tcg/api/internal/payout"
	"auctionhous-tcg/api/internal/photosession"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
	"auctionhous-tcg/api/internal/user"
	"auctionhous-tcg/api/internal/watchlist"
	"auctionhous-tcg/api/internal/webhook"
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
	listing.AllowMissingPhotos = cfg.Environment != "production"
	seller.AllowDevTierAdjust = cfg.Environment != "production"

	ctx := context.Background()
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealthz)

	if cfg.CardCatalogProjectID == "" {
		log.Println("CARD_CATALOG_PROJECT_ID not set — GET /catalog/search disabled (see apps/api/.env.example)")
	} else {
		catalogClient, err := cardcatalog.NewClient(ctx, cfg.CardCatalogProjectID, cfg.CardCatalogCredentialsFile)
		if err != nil {
			log.Fatalf("card catalog client: %v", err)
		}
		defer catalogClient.Close()
		mux.HandleFunc("GET /catalog/search", cardcatalog.HandleSearch(catalogClient))
	}

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
		mux.Handle("POST /me/stickers", verifier.RequireAuth(user.HandleSetStickers(pool)))
		mux.Handle("POST /me/canvas", verifier.RequireAuth(user.HandleSetCanvas(pool)))
		mux.Handle("POST /me/widgets", verifier.RequireAuth(user.HandleSetWidgets(pool)))
		mux.Handle("GET /me/address", verifier.RequireAuth(address.HandleGet(pool)))
		mux.Handle("POST /me/address", verifier.RequireAuth(address.HandleUpsert(pool)))
		mux.HandleFunc("GET /usernames/available", user.HandleUsernameAvailable(pool))
		mux.HandleFunc("GET /users/{username}", user.HandleGetByUsername(pool))
		mux.HandleFunc("GET /users/{username}/reviews", feedback.HandleListForSeller(pool))
		mux.Handle("POST /users/{username}/reviews", verifier.RequireAuth(feedback.HandleUpsert(pool)))
		mux.Handle("GET /users/{username}/reviewable-purchases", verifier.RequireAuth(feedback.HandleEligibleListings(pool)))
		mux.Handle("POST /users/{username}/reviews/{reviewId}/reply", verifier.RequireAuth(feedback.HandleReply(pool)))
		mux.HandleFunc("GET /users/{username}/buyer-stats", buyerreview.HandleStatsForUser(pool))

		shippingClient := shipping.NewClient(cfg.ShippoAPIToken)
		pbClient := shipping.NewPitneyBowesClient(cfg.PitneyBowesClientID, cfg.PitneyBowesClientSecret, cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
		if !pbClient.IsConfigured() {
			log.Println("PITNEY_BOWES_CLIENT_ID/SECRET not set — tracked-envelope label purchase disabled (see apps/api/.env.example)")
		}
		mux.Handle("POST /listings", verifier.RequireAuth(listing.HandleCreate(pool, shippingClient)))
		mux.HandleFunc("GET /listings", listing.HandleList(pool))
		mux.HandleFunc("GET /listings/counts", listing.HandleCounts(pool))
		mux.HandleFunc("GET /listings/{id}", listing.HandleGet(pool))
		paymentClient := payment.NewClient(cfg.StripeSecretKey)
		mailClient := mail.NewClient(cfg.ResendAPIKey, cfg.ClaimsNotifyFrom, cfg.ClaimsNotifyTo)
		if !mailClient.IsConfigured() {
			log.Println("RESEND_API_KEY not set — claim human-review email notifications disabled (see apps/api/.env.example)")
		}
		listing.RequireSellerOnboarded = paymentClient.IsConfigured()
		if !paymentClient.IsConfigured() {
			log.Println("STRIPE_SECRET_KEY not set — Buy It Now falls back to its no-payment mock path (see apps/api/.env.example)")
		} else {
			mux.Handle("POST /listings/{id}/checkout-intent", verifier.RequireAuth(auction.HandleCreateCheckoutIntent(pool, paymentClient)))
			mux.Handle("GET /me/payment-methods", verifier.RequireAuth(paymentmethod.HandleList(pool, paymentClient)))
			mux.Handle("POST /me/payment-methods/setup-intent", verifier.RequireAuth(paymentmethod.HandleCreateSetupIntent(pool, paymentClient)))
			mux.Handle("POST /me/payment-methods/{id}/default", verifier.RequireAuth(paymentmethod.HandleSetDefault(pool, paymentClient)))
			mux.Handle("DELETE /me/payment-methods/{id}", verifier.RequireAuth(paymentmethod.HandleDelete(pool, paymentClient)))
			mux.Handle("GET /me/payment-methods/banks", verifier.RequireAuth(paymentmethod.HandleListBanks(pool, paymentClient)))
			mux.Handle("POST /me/payment-methods/banks/setup-intent", verifier.RequireAuth(paymentmethod.HandleCreateBankSetupIntent(pool, paymentClient)))
			mux.Handle("POST /me/payment-methods/banks/{id}/default", verifier.RequireAuth(paymentmethod.HandleSetDefault(pool, paymentClient)))
			mux.Handle("DELETE /me/payment-methods/banks/{id}", verifier.RequireAuth(paymentmethod.HandleDelete(pool, paymentClient)))

			mux.Handle("GET /me/seller/connect-account", verifier.RequireAuth(seller.HandleGetConnectAccount(pool)))
			mux.Handle("POST /me/seller/connect-account", verifier.RequireAuth(seller.HandleCreateConnectAccount(pool, paymentClient, cfg.WebOrigin)))
			mux.Handle("POST /me/seller/connect-account/onboarding-link", verifier.RequireAuth(seller.HandleCreateOnboardingLink(pool, paymentClient, cfg.WebOrigin)))

			mux.Handle("GET /me/seller/tier", verifier.RequireAuth(seller.HandleGetMyTier(pool)))
			mux.Handle("POST /me/seller/haus-trust/apply", verifier.RequireAuth(seller.HandleApplyForHausTrust(pool)))
			mux.Handle("GET /admin/haus-trust-applications", verifier.RequireAuth(seller.HandleAdminListHausTrustApplications(pool, cfg.AdminEmails)))
			mux.Handle("POST /admin/haus-trust-applications/{id}/decide", verifier.RequireAuth(seller.HandleAdminDecideHausTrustApplication(pool, cfg.AdminEmails)))

			// Dev-only — real auth (RequireAuth), gated to non-production at
			// runtime inside DevAdjustTier itself (seller.AllowDevTierAdjust,
			// set above). Registered unconditionally, same as every other
			// dev-only route in this file (AllowDevDurations et al.) — the
			// route existing isn't the gate, calling it successfully is.
			mux.Handle("POST /me/seller/dev-tier-adjust", verifier.RequireAuth(seller.HandleDevAdjustTier(pool)))

			mux.Handle("POST /me/payout/instant", verifier.RequireAuth(payout.HandleTriggerInstant(pool, paymentClient)))
			mux.Handle("POST /me/payout/standard", verifier.RequireAuth(payout.HandleTriggerStandard(pool, paymentClient)))
			mux.Handle("GET /me/payout/summary", verifier.RequireAuth(payout.HandleSummary(pool)))

			mux.Handle("GET /me/orders", verifier.RequireAuth(order.HandleListMine(pool)))
			mux.Handle("GET /listings/{id}/order", verifier.RequireAuth(order.HandleGetForListing(pool)))
			mux.Handle("POST /listings/{id}/order/evidence", verifier.RequireAuth(order.HandleAddEvidence(pool)))
			mux.Handle("POST /listings/{id}/order/ship", verifier.RequireAuth(order.HandleShip(pool)))
			mux.Handle("GET /listings/{id}/order/buyer-review", verifier.RequireAuth(buyerreview.HandleGetForListing(pool)))
			mux.Handle("POST /listings/{id}/order/buyer-review", verifier.RequireAuth(buyerreview.HandleUpsert(pool)))
			if !shippingClient.IsConfigured() && !pbClient.IsConfigured() {
				log.Println("SHIPPO_API_TOKEN and PITNEY_BOWES_CLIENT_ID/SECRET not set — shipping-label purchase disabled (see apps/api/.env.example)")
			} else {
				// HandleBuyLabel itself checks per-mechanism configuration and
				// 503s if the specific vendor an order needs isn't set up —
				// registering the route as soon as either is configured lets
				// e.g. Shippo-only orders work even before Pitney Bowes
				// credentials exist, matching this codebase's usual
				// per-integration graceful degradation.
				mux.Handle("POST /listings/{id}/order/shipping-label", verifier.RequireAuth(shipping.HandleBuyLabel(pool, shippingClient, pbClient)))
				mux.Handle("GET /listings/{id}/order/shipping-label/download", verifier.RequireAuth(shipping.HandleDownloadLabel(pool)))
			}

			mux.Handle("GET /listings/{id}/order/claim", verifier.RequireAuth(dispute.HandleGetForListing(pool)))
			mux.Handle("POST /claims", verifier.RequireAuth(dispute.HandleOpen(pool)))
			mux.Handle("GET /claims/{id}", verifier.RequireAuth(dispute.HandleGet(pool)))
			mux.Handle("POST /claims/{id}/messages", verifier.RequireAuth(dispute.HandleAddMessage(pool)))
			mux.Handle("POST /claims/{id}/evidence", verifier.RequireAuth(dispute.HandleAddEvidence(pool)))
			mux.Handle("POST /claims/{id}/resolve", verifier.RequireAuth(dispute.HandleResolveByAgreement(pool)))
			mux.Handle("POST /claims/{id}/partial-refund-offer", verifier.RequireAuth(dispute.HandleProposePartialRefund(pool)))
			mux.Handle("POST /claims/{id}/partial-refund-accept", verifier.RequireAuth(dispute.HandleAcceptPartialRefund(pool, paymentClient)))
			mux.Handle("POST /claims/{id}/escalate", verifier.RequireAuth(dispute.HandleEscalate(pool, paymentClient, mailClient, cfg.WebOrigin)))
			mux.Handle("POST /claims/{id}/appeal", verifier.RequireAuth(dispute.HandleAppeal(pool)))
			// Minimal admin-only surface (email allowlist, see
			// internal/dispute/http.go's doc comment — no real admin app
			// exists in this repo yet).
			mux.Handle("POST /claims/{id}/decide", verifier.RequireAuth(dispute.HandleDecide(pool, paymentClient, cfg.AdminEmails)))
			mux.Handle("POST /claims/{id}/decide-appeal", verifier.RequireAuth(dispute.HandleDecideAppeal(pool, paymentClient, cfg.AdminEmails)))
			mux.Handle("GET /admin/claims", verifier.RequireAuth(dispute.HandleAdminList(pool, cfg.AdminEmails)))
			mux.Handle("GET /admin/claims/{id}", verifier.RequireAuth(dispute.HandleAdminGet(pool, cfg.AdminEmails)))

			mux.Handle("GET /admin/metrics", verifier.RequireAuth(metrics.HandleGet(pool, cfg.AdminEmails)))
		}

		if cfg.StripeWebhookSecret == "" {
			log.Println("STRIPE_WEBHOOK_SECRET not set — /webhooks/stripe disabled (see apps/api/.env.example)")
		} else {
			// Deliberately NOT wrapped in verifier.RequireAuth — Stripe
			// authenticates via the Stripe-Signature header, verified
			// inside HandleStripe itself, not a Supabase JWT.
			mux.HandleFunc("POST /webhooks/stripe", webhook.HandleStripe(pool, cfg.StripeWebhookSecret, mailClient, cfg.WebOrigin))
		}

		if cfg.CarrierWebhookSecret == "" {
			log.Println("CARRIER_WEBHOOK_SECRET not set — /webhooks/carrier disabled (see apps/api/.env.example)")
		} else {
			// Also NOT wrapped in verifier.RequireAuth — see
			// internal/shipping/webhook.go on why this is a shared-secret
			// HMAC stand-in rather than a real carrier vendor's signature
			// scheme.
			mux.HandleFunc("POST /webhooks/carrier", shipping.HandleDeliveryWebhook(pool, paymentClient, cfg.CarrierWebhookSecret))
		}

		mux.Handle("POST /listings/{id}/bids", verifier.RequireAuth(auction.HandlePlaceBid(pool)))
		mux.Handle("POST /listings/{id}/buy-now", verifier.RequireAuth(auction.HandleBuyNow(pool, paymentClient)))
		mux.Handle("/me/bids", verifier.RequireAuth(auction.HandleMyBids(pool)))
		mux.Handle("GET /me/purchases", verifier.RequireAuth(auction.HandleMyPurchases(pool)))
		mux.Handle("GET /me/sales", verifier.RequireAuth(auction.HandleMySales(pool)))
		mux.Handle("GET /me/celebrations", verifier.RequireAuth(auction.HandleMyCelebrations(pool)))
		mux.Handle("POST /me/celebrations/ack", verifier.RequireAuth(auction.HandleAckCelebration(pool)))
		mux.Handle("GET /me/notifications", verifier.RequireAuth(notification.HandleMyNotifications(pool)))
		mux.Handle("POST /me/notifications/{id}/read", verifier.RequireAuth(notification.HandleMarkRead(pool)))
		mux.Handle("POST /me/notifications/read-all", verifier.RequireAuth(notification.HandleMarkAllRead(pool)))

		mux.Handle("GET /me/messages", verifier.RequireAuth(message.HandleMyThreads(pool)))
		mux.Handle("POST /me/messages", verifier.RequireAuth(message.HandleStartThread(pool)))
		mux.Handle("GET /me/messages/{id}", verifier.RequireAuth(message.HandleGetThread(pool)))
		mux.Handle("POST /me/messages/{id}", verifier.RequireAuth(message.HandleSendMessage(pool)))

		mux.Handle("GET /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleGetStatus(pool)))
		mux.Handle("POST /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleAdd(pool)))
		mux.Handle("DELETE /listings/{id}/watch", verifier.RequireAuth(watchlist.HandleRemove(pool)))
		mux.Handle("/me/watchlist", verifier.RequireAuth(watchlist.HandleMyWatchlist(pool)))

		// Sell wizard's QR "upload from your phone" handoff (CLAUDE.md §6.13).
		// HandleGetStatus/HandleUploadPhoto are deliberately NOT wrapped in
		// verifier.RequireAuth — the phone side of this flow is never logged
		// in, the session id itself is the credential (see
		// internal/photosession's package doc).
		mux.Handle("POST /photo-sessions", verifier.RequireAuth(photosession.HandleCreate(pool)))
		mux.Handle("GET /photo-sessions/{id}/photos", verifier.RequireAuth(photosession.HandleListPhotos(pool)))
		mux.HandleFunc("GET /photo-sessions/{id}", photosession.HandleGetStatus(pool))

		if cfg.SupabaseServiceRoleKey == "" {
			log.Println("SUPABASE_SERVICE_ROLE_KEY not set — phone photo upload disabled (POST /photo-sessions/{id}/photos, see apps/api/.env.example)")
		} else {
			mux.HandleFunc("POST /photo-sessions/{id}/photos", photosession.HandleUploadPhoto(pool, cfg.SupabaseURL, cfg.SupabaseServiceRoleKey))
		}
	}

	// Always also allow plain localhost:4000 in non-production, on top of
	// whatever WEB_ORIGIN is set to (typically the dev machine's current LAN
	// IP, needed for phone testing) — see WithCORS's doc comment for why a
	// single fixed origin kept silently breaking one testing mode or the
	// other. Never added in production: WEB_ORIGIN there is the one real
	// deployed origin, and localhost has no meaning to a real user's browser.
	corsOrigins := []string{cfg.WebOrigin}
	if cfg.Environment != "production" && cfg.WebOrigin != "http://localhost:4000" {
		corsOrigins = append(corsOrigins, "http://localhost:4000")
	}

	log.Printf("api listening on :%s (CORS allowing %v)", cfg.Port, corsOrigins)
	if err := http.ListenAndServe(":"+cfg.Port, platform.WithCORS(corsOrigins, mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
