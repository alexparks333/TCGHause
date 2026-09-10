package auction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
)

var ErrNoBuyItNowPrice = errors.New("this auction has no Buy It Now price")

// BuyNow buys an auction-format listing outright at its buy_it_now_price_cents,
// skipping the rest of the bidding entirely — no matter how many bids already
// exist or how much time is left on the clock. This IS a close, just
// buyer-triggered instead of cmd/worker's timer (CloseEndedAuctions), and
// races against that exact same timer via the same guard it uses:
// closed_at is only ever set once, checked under a row lock, so a Buy It Now
// click and the worker's next tick can never both "win" the same auction —
// whichever gets the row lock first commits, the other sees closed_at
// already set and fails cleanly with ErrAuctionEnded.
func BuyNow(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID string) (*listing.Listing, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		buyItNowPriceCents *int64
		closedAt           *time.Time
		endsAt             time.Time
		sellerID           string
	)
	err = tx.QueryRow(ctx, `
		select a.buy_it_now_price_cents, a.closed_at, a.ends_at, l.seller_id
		from auctions a
		join listings l on l.id = a.listing_id
		where a.listing_id = $1
		for update of a
	`, listingID).Scan(&buyItNowPriceCents, &closedAt, &endsAt, &sellerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuctionNotFound
		}
		return nil, fmt.Errorf("read auction: %w", err)
	}

	if buyerID == sellerID {
		return nil, ErrSelfBid
	}
	if buyItNowPriceCents == nil {
		return nil, ErrNoBuyItNowPrice
	}
	if closedAt != nil || !time.Now().Before(endsAt) {
		return nil, ErrAuctionEnded
	}

	tag, err := tx.Exec(ctx, `
		update auctions
		set outcome = 'bought_now', closed_at = now(),
			current_price_cents = $1, high_bidder_id = $2, version = version + 1,
			bid_count = bid_count + 1
		where listing_id = $3 and closed_at is null
	`, *buyItNowPriceCents, buyerID, listingID)
	if err != nil {
		return nil, fmt.Errorf("update auction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAuctionEnded
	}

	if _, err := tx.Exec(ctx, `
		update listings set status = 'ended' where id = $1
	`, listingID); err != nil {
		return nil, fmt.Errorf("update listing: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into bids (auction_listing_id, bidder_id, max_bid_cents)
		values ($1, $2, $3)
	`, listingID, buyerID, *buyItNowPriceCents); err != nil {
		return nil, fmt.Errorf("insert bid: %w", err)
	}

	if err := notification.Create(ctx, tx, buyerID, notification.KindBought, listingID); err != nil {
		return nil, fmt.Errorf("notify bought: %w", err)
	}
	if err := notification.Create(ctx, tx, sellerID, notification.KindSold, listingID); err != nil {
		return nil, fmt.Errorf("notify sold: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return listing.Get(ctx, pool, listingID)
}

// ErrAlreadyPaid indicates a won auction has already been paid for — the
// compare-and-swap guard in PayForWonAuction failing is what this maps to.
var ErrAlreadyPaid = errors.New("this purchase has already been paid for")

// PayForWonAuction records payment for an auction buyerID already won via
// bidding (outcome = 'sold') — a fixed-price or Buy It Now purchase
// transfers ownership AND collects payment atomically in one step, but a
// regular bidding win only ever resolved who won (cmd/worker's close
// pass); nothing has ever collected payment for it. There's no ownership
// to contest here — ownership was already decided when the auction
// closed — so the only race that matters is against double-payment: the
// update below is a compare-and-swap guarded on paid_at being null, so
// clicking "Pay" twice (or two tabs) can never double-charge — the second
// attempt affects zero rows and fails cleanly with ErrAlreadyPaid.
func PayForWonAuction(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID string) (*listing.Listing, error) {
	tag, err := pool.Exec(ctx, `
		update auctions
		set paid_at = now()
		where listing_id = $1 and high_bidder_id = $2 and outcome = 'sold' and paid_at is null
	`, listingID, buyerID)
	if err != nil {
		return nil, fmt.Errorf("update auction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadyPaid
	}
	return listing.Get(ctx, pool, listingID)
}

// PayForWonFixedListing mirrors PayForWonAuction for a fixed-format listing
// already reserved for buyerID via an accepted offer (internal/offer.
// Accept sets buyer_id/sold_price_cents immediately, payment is a separate
// step) — same compare-and-swap-on-paid_at guard, so double-clicking "Pay"
// can never double-charge.
func PayForWonFixedListing(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID string) (*listing.Listing, error) {
	tag, err := pool.Exec(ctx, `
		update listings
		set paid_at = now()
		where id = $1 and buyer_id = $2 and paid_at is null
	`, listingID, buyerID)
	if err != nil {
		return nil, fmt.Errorf("update listing: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadyPaid
	}
	return listing.Get(ctx, pool, listingID)
}

var ErrPaymentRequired = errors.New("payment is required for this purchase")

type buyNowRequest struct {
	// PaymentIntentID is optional only when Stripe isn't configured at all
	// (paymentClient == nil) — the original always-free mock-payment path,
	// preserved for local dev without Stripe keys. Once Stripe IS
	// configured, this is required and re-verified server-side (see below)
	// — the backend's own config is what decides whether payment is
	// mandatory, not anything the client claims, so calling this endpoint
	// directly can't skip payment once real checkout is live.
	PaymentIntentID string `json:"paymentIntentId"`
}

// HandleBuyNow dispatches a Buy It Now purchase to the right path for the
// listing's format: an auction-format listing with a buy_it_now_price_cents
// set (BuyNow, above) or a fixed-format listing (listing.BuyNowFixed, which
// IS its own Buy It Now — a fixed listing's price_cents always was the BIN
// price). One route, since the frontend's Buy It Now button doesn't need to
// know or care which shape a listing is under the hood.
//
// When a paymentIntentId is supplied (the real Stripe checkout flow,
// app/checkout/[id] + HandleCreateCheckoutIntent), the card was only ever
// authorized, never charged — this handler captures it AFTER the atomic
// purchase below has actually committed, and cancels it (releasing the
// hold, no charge) if the purchase loses the race or fails validation.
// That ordering is what makes two buyers safely racing to buy the same
// card safe even with real payment involved: whichever's atomic compare-
// and-swap commits first is the only one who ever gets captured/charged.
func HandleBuyNow(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		listingID := r.PathValue("id")

		var req buyNowRequest
		if r.Body != nil {
			// Optional body — the no-Stripe mock-payment path posts
			// nothing at all, same as before this existed. A malformed
			// body here just leaves req.PaymentIntentID empty rather than
			// failing the request; the checks below are what actually
			// enforce payment.
			_ = json.NewDecoder(r.Body).Decode(&req)
		}

		if paymentClient.IsConfigured() && req.PaymentIntentID == "" {
			http.Error(w, ErrPaymentRequired.Error(), http.StatusPaymentRequired)
			return
		}

		lst, err := listing.Get(r.Context(), pool, listingID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, listing.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		// A closed auction (won via bidding, not Buy It Now) that this
		// buyer already won just needs payment recorded — PayForWonAuction
		// sets paid_at itself as its own compare-and-swap guard, so the
		// generic markPaid call below must be skipped for this path (it
		// would otherwise be a redundant, if harmless, second write).
		payingForWonAuction := lst.Outcome != nil && *lst.Outcome == "sold" &&
			lst.HighBidderID != nil && *lst.HighBidderID == buyerID

		// A fixed-format listing already reserved for this buyer via an
		// accepted offer (internal/offer.Accept) — same "ownership already
		// resolved, this is purely a payment step" shape as
		// payingForWonAuction above, just for the other format.
		payingForWonFixedOffer := lst.Format == listing.FormatFixed &&
			lst.BuyerID != nil && *lst.BuyerID == buyerID

		// The seller still needs to be checked here (not just at
		// checkout-intent creation time) — same "never trust anything
		// computed earlier in a gap that could contain a race" reasoning as
		// everywhere else in this codebase — but the PaymentIntent itself
		// lives on the PLATFORM account regardless of the seller's Connect
		// state (docs/Legal_MoneyTransitter.md / separate charges and
		// transfers), so Retrieve below never needs a connected account id.
		var pi *stripe.PaymentIntent
		if req.PaymentIntentID != "" {
			if !paymentClient.IsConfigured() {
				http.Error(w, "payments are not configured", http.StatusBadRequest)
				return
			}
			stripeAccountID, err := seller.RequirePayoutsEnabled(r.Context(), pool, lst.SellerID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if stripeAccountID == "" {
				// Same distinct-from-409 reasoning as checkout.go's
				// identical check.
				http.Error(w, ErrSellerNotOnboarded.Error(), http.StatusPreconditionFailed)
				return
			}
			pi, err = paymentClient.Retrieve(r.Context(), req.PaymentIntentID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			// Never trust a client-supplied paymentIntentId at face value:
			// it must actually belong to THIS listing and THIS buyer, and
			// actually be genuinely authorized — otherwise a forged/stale/
			// reused id could let someone skip payment entirely or reuse
			// one authorization across listings.
			if pi.Metadata["listing_id"] != listingID || pi.Metadata["buyer_id"] != buyerID {
				http.Error(w, "payment does not match this purchase", http.StatusBadRequest)
				return
			}
			// The card rail sits in "requires_capture" until this
			// handler's own Capture call below; the ACH rail has no
			// capture step at all (internal/payment.CreateAchIntent's doc
			// comment explains why) — a confirmed-but-still-clearing ACH
			// debit sits in "processing" instead, and that's the correct,
			// expected status to see here, not a sign something's wrong.
			validStatus := pi.Status == stripe.PaymentIntentStatusRequiresCapture || pi.Status == stripe.PaymentIntentStatusProcessing
			if !validStatus {
				http.Error(w, fmt.Sprintf("payment is not ready (status: %s)", pi.Status), http.StatusConflict)
				return
			}
		}
		rail := order.RailCard
		if pi != nil && containsUSBankAccount(pi.PaymentMethodTypes) {
			rail = order.RailAch
		}

		var result *listing.Listing
		switch {
		case payingForWonFixedOffer:
			result, err = PayForWonFixedListing(r.Context(), pool, listingID, buyerID)
		case lst.Format == listing.FormatFixed:
			result, err = listing.BuyNowFixed(r.Context(), pool, listingID, buyerID)
		case payingForWonAuction:
			result, err = PayForWonAuction(r.Context(), pool, listingID, buyerID)
		default:
			result, err = BuyNow(r.Context(), pool, listingID, buyerID)
		}
		if err != nil {
			if pi != nil {
				// This buyer authorized a card but lost the race (or the
				// listing became invalid between authorizing and now) —
				// release the hold. They were never charged.
				if cancelErr := paymentClient.Cancel(r.Context(), pi.ID); cancelErr != nil {
					log.Printf("buy-now: failed to cancel payment intent %s after lost purchase: %v", pi.ID, cancelErr)
				}
			}
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, listing.ErrNotFound), errors.Is(err, ErrAuctionNotFound):
				status = http.StatusNotFound
			case errors.Is(err, listing.ErrAlreadySold), errors.Is(err, ErrAuctionEnded), errors.Is(err, ErrNoBuyItNowPrice), errors.Is(err, listing.ErrNotFixedFormat), errors.Is(err, ErrAlreadyPaid):
				status = http.StatusConflict
			case errors.Is(err, listing.ErrSelfPurchase), errors.Is(err, ErrSelfBid):
				status = http.StatusForbidden
			}
			http.Error(w, err.Error(), status)
			return
		}

		if pi != nil {
			// The card rail needs an explicit Capture call (it authorized
			// only, per CreateIntent's manual capture_method); the ACH
			// rail has none — it's already auto-capturing the moment it
			// was confirmed client-side, per CreateAchIntent's doc
			// comment, so "resolving a win" for ACH means simply not
			// cancelling it.
			var captureErr error
			var chargeID string
			if rail == order.RailCard {
				var captured *stripe.PaymentIntent
				captured, captureErr = paymentClient.Capture(r.Context(), pi.ID)
				if captureErr == nil && captured.LatestCharge != nil {
					chargeID = captured.LatestCharge.ID
				}
			}
			if captureErr != nil {
				// The purchase already committed in our own database — a
				// capture failure on an already-authorized, just-verified
				// PaymentIntent is effectively unheard of in Stripe test
				// mode. Logged rather than unwound: reversing the DB
				// purchase here would reintroduce exactly the double-sold
				// race this whole flow exists to prevent.
				log.Printf("buy-now: DB purchase committed but Stripe capture failed for %s: %v", pi.ID, captureErr)
			} else {
				// paid_at only reflects genuinely completed payment — real
				// for the card rail (capture just succeeded), not yet true
				// for ACH (still clearing; internal/webhook.
				// advancePaymentPendingOrder sets it once payment_intent.
				// succeeded actually arrives, days later).
				if rail == order.RailCard {
					if payingForWonAuction || payingForWonFixedOffer {
						// PayForWonAuction/PayForWonFixedListing already set
						// paid_at as part of their own atomic guard —
						// nothing left to record.
						if refreshed, err := listing.Get(r.Context(), pool, listingID); err == nil {
							result = refreshed
						}
					} else if err := markPaid(r.Context(), pool, result); err != nil {
						// The charge itself succeeded — this only affects
						// Buy History's payment-status display, not the
						// purchase itself, so it's logged, not fatal.
						log.Printf("buy-now: captured payment but failed to record paid_at for %s: %v", listingID, err)
					} else if refreshed, err := listing.Get(r.Context(), pool, listingID); err == nil {
						result = refreshed
					}
				}

				// The order record (internal/order) is a separate,
				// best-effort step layered on top of an already-committed
				// payment — same reasoning as markPaid above: reversing an
				// already-charged/already-submitted purchase here would be
				// worse than a logged inconsistency. Re-quotes fresh from
				// the seller's currently-stored tier rather than trusting
				// anything computed at checkout-intent time (CLAUDE.md §5.3).
				createOrderRecord(r.Context(), pool, listingID, buyerID, lst.SellerID, pi, chargeID, rail, result)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// shippingFromMetadata reads back the shipping_cents/signature_required
// values checkout.go stamped onto the PaymentIntent at authorization time
// (payment.shippingMetadata) — the single source of truth for what the
// buyer actually agreed to pay, since it came from a live Shippo quote
// against the real addresses when one was possible. Falls back to the old
// estimate-based shipping.ChargedCents only for a PaymentIntent that
// predates this metadata (a malformed/missing value parses to the zero
// value, which fails the `ok` checks below just as cleanly as a genuinely
// absent key).
func shippingFromMetadata(pi *stripe.PaymentIntent, fallbackPreset shipping.Preset, fallbackEstimateCents *int64, fallbackSignatureRequired bool) (shippingCents int64, signatureRequired bool) {
	if pi != nil {
		if raw, ok := pi.Metadata["shipping_cents"]; ok {
			if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
				return parsed, pi.Metadata["signature_required"] == "true"
			}
		}
	}
	return shipping.ChargedCents(fallbackPreset, fallbackEstimateCents), fallbackSignatureRequired
}

func containsUSBankAccount(types []string) bool {
	for _, t := range types {
		if t == "us_bank_account" {
			return true
		}
	}
	return false
}

// createOrderRecord builds the fee quote fresh from result's final sale
// price and the seller's current tier, inserts the orders/order_items row
// (internal/order.CreateFromWin), and advances it to the right starting
// point for the rail actually used: the card rail captures synchronously
// in this flow, so it goes straight to awaiting_ship; the ACH rail lands in
// payment_pending and waits for internal/webhook.advancePaymentPendingOrder
// to move it further once Stripe confirms the debit actually cleared, days
// later. Logged, not returned as an error: this runs only after a real
// Stripe payment already committed, so a failure here must never look like
// the purchase itself failed.
func createOrderRecord(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID, sellerID string, pi *stripe.PaymentIntent, chargeID string, rail order.Rail, result *listing.Listing) {
	subtotalCents := subtotalForResult(result)
	if subtotalCents <= 0 {
		log.Printf("buy-now: no purchasable price on result for order record (listing %s)", listingID)
		return
	}

	// The listing's own chosen preset is only a floor the seller opted into
	// at listing time — never trusted alone, since a low-starting-bid
	// auction can close well above the price that was knowable when the
	// preset was picked. UpgradePreset keeps whichever mechanism is
	// stricter, per internal/shipping's package doc — still safe to
	// recompute fresh (a pure function of the subtotal/listing preset),
	// unlike shippingCents/signatureRequired below.
	resolvedPreset, fallbackSignatureRequired := shipping.UpgradePreset(shipping.Preset(result.ShippingPreset), subtotalCents, result.RequestSignature)

	// shippingCents/signatureRequired come straight off the PaymentIntent's
	// own metadata — the exact live-quoted number checkout.go authorized
	// and the buyer was actually charged (shipping.ChargedCentsLive), never
	// recomputed here. This function runs only after Stripe already
	// committed the payment; a fresh recompute could legitimately return a
	// different number (carrier rates can shift between authorization and
	// this capture), and recording anything other than what was actually
	// charged would silently desync the order's own ledger from money that
	// already moved — exactly the class of bug CLAUDE.md §5.3 exists to
	// prevent. Falls back to the old estimate-based computation only for a
	// PaymentIntent created before this metadata existed.
	shippingCents, signatureRequired := shippingFromMetadata(pi, resolvedPreset, result.EstimatedShippingCents, fallbackSignatureRequired)

	quote, tier, tierPct, err := quoteForListing(ctx, pool, sellerID, subtotalCents, shippingCents)
	if err != nil {
		log.Printf("buy-now: failed to compute order quote for %s: %v", listingID, err)
		return
	}

	in := order.CreateInput{
		Quote:                 quote,
		Rail:                  rail,
		Tier:                  string(tier),
		TierPct:               tierPct,
		StripePaymentIntentID: pi.ID,
		StripeChargeID:        chargeID,
		ShippingPreset:        string(resolvedPreset),
		SignatureRequired:     signatureRequired,
	}

	// A won-via-bidding purchase already has a real, unpaid order row —
	// created the instant the auction closed (createPendingOrderForWin,
	// close.go) — so payment here finalizes that exact row in place rather
	// than inserting a second one (order_items' unique listing_id index
	// would reject a second insert for the same listing anyway). A Buy It
	// Now / fixed-price purchase never went through that path, so falls
	// through to the original insert-fresh behavior below.
	if existing, err := order.GetForListing(ctx, pool, listingID); err == nil {
		if ferr := order.FinalizePayment(ctx, pool, existing.ID, in); ferr != nil {
			log.Printf("buy-now: failed to finalize pending order %s for %s: %v", existing.ID, listingID, ferr)
			return
		}
		if rail == order.RailCard {
			if terr := order.Transition(ctx, pool, existing.ID, order.StatePaid, order.StateAwaitingShip); terr != nil {
				log.Printf("buy-now: failed to transition order %s to awaiting_ship: %v", existing.ID, terr)
			}
		}
		return
	} else if !errors.Is(err, order.ErrNotFound) {
		log.Printf("buy-now: failed to look up existing order for %s: %v", listingID, err)
		return
	}

	orderID, err := order.CreateFromWin(ctx, pool, listingID, buyerID, sellerID, in)
	if err != nil {
		log.Printf("buy-now: failed to create order record for %s: %v", listingID, err)
		return
	}

	if rail == order.RailAch {
		if err := order.Transition(ctx, pool, orderID, order.StateCreated, order.StatePaymentPending); err != nil {
			log.Printf("buy-now: failed to transition order %s to payment_pending: %v", orderID, err)
		}
		return
	}

	if err := order.Transition(ctx, pool, orderID, order.StateCreated, order.StatePaid); err != nil {
		log.Printf("buy-now: failed to transition order %s to paid: %v", orderID, err)
		return
	}
	if err := order.Transition(ctx, pool, orderID, order.StatePaid, order.StateAwaitingShip); err != nil {
		log.Printf("buy-now: failed to transition order %s to awaiting_ship: %v", orderID, err)
	}
}

// subtotalForResult derives the item price an order should be quoted
// against from a just-completed purchase — mirrors checkout.go's own
// subtotal derivation, simplified because ownership is already resolved by
// this point (no BuyerID-nil/Outcome-nil branches to consider).
func subtotalForResult(result *listing.Listing) int64 {
	if result.Format == listing.FormatFixed {
		if result.SoldPriceCents != nil {
			return *result.SoldPriceCents
		}
		if result.PriceCents != nil {
			return *result.PriceCents
		}
		return 0
	}
	if result.CurrentPriceCents != nil {
		return *result.CurrentPriceCents
	}
	return 0
}

// markPaid records that a Buy It Now purchase was actually paid for via a
// real (captured) Stripe charge — set on whichever table actually applies
// to this listing's format, and only ever called after that capture has
// already succeeded.
func markPaid(ctx context.Context, pool *pgxpool.Pool, lst *listing.Listing) error {
	if lst.Format == listing.FormatFixed {
		_, err := pool.Exec(ctx, `update listings set paid_at = now() where id = $1`, lst.ID)
		return err
	}
	_, err := pool.Exec(ctx, `update auctions set paid_at = now() where listing_id = $1`, lst.ID)
	return err
}
