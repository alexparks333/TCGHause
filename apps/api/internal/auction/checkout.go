package auction

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/paymentmethod"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
)

// ErrSellerNotOnboarded blocks checkout when the seller hasn't finished
// Stripe Connect onboarding — a direct charge (design doc v2 §5.3) can only
// be created on a connected account that Stripe has actually enabled for
// charges, never a bare stripe_account_id that exists but never finished
// verification.
var ErrSellerNotOnboarded = errors.New("this seller hasn't finished setting up payouts yet")

type checkoutIntentResponse struct {
	ClientSecret    string `json:"clientSecret"`
	PaymentIntentID string `json:"paymentIntentId"`
	Rail            string `json:"rail"`
	// AmountCents is what this specific intent actually charges — matches
	// CardAmountCents or BankAmountCents below depending on Rail.
	AmountCents int64 `json:"amountCents"`
	// CardAmountCents/BankAmountCents/RealizedSavingCents let the checkout
	// page show both prices side by side (design doc v2 §2.7: card is
	// always the default/listed price, bank framed as a savings offer)
	// without a second round trip — the buyer sees the choice before
	// picking a rail, this response just reflects whichever they already
	// picked (or "card", the default, on first load).
	CardAmountCents     int64 `json:"cardAmountCents"`
	BankAmountCents     int64 `json:"bankAmountCents"`
	RealizedSavingCents int64 `json:"realizedSavingCents"`
	// SellerFeeCents/SellerNetCents are identical regardless of rail
	// (design doc v2 §2.3's invariant) — informational, exposed for the
	// same "transparency by default" reason as docs/PercentageModel.md §3.
	SellerFeeCents int64 `json:"sellerFeeCents"`
	SellerNetCents int64 `json:"sellerNetCents"`
	TaxCents       int64 `json:"taxCents"`
	// SavedCard/SavedBank reflect whichever saved payment method actually
	// ended up attached to this intent — either paymentMethodId (below)
	// if the buyer explicitly picked one in MockCheckout.tsx's picker, or
	// their default, if they haven't chosen yet. Never both set at once
	// (Rail decides which one is even possible). A connected-account
	// direct charge can't show Stripe's own "browse every saved method"
	// Payment Element carousel (design doc v2 §5.4 — see
	// payment.ClonePaymentMethodToConnectedAccount's doc comment for why),
	// so this app's own frontend UI is the picker instead.
	SavedCard *paymentmethod.SavedCard `json:"savedCard,omitempty"`
	SavedBank *paymentmethod.SavedBank `json:"savedBank,omitempty"`
}

// HandleCreateCheckoutIntent authorizes a payment for listingID's Buy It
// Now price on the rail the buyer picked (?rail=card, the default, or
// ?rail=ach) — the first step of the real Stripe checkout flow. Lazy per-
// rail creation, not both up front, so switching rails on the checkout page
// doesn't leave an unused intent behind (design doc v2 §6's recommendation).
// This never touches the listing itself: two buyers can both call this for
// the same listing and both get a valid authorization, exactly like both
// being able to sit on the checkout page at once. The price/eligibility
// checks here are a courtesy (so the UI doesn't authorize a payment for a
// listing that's obviously already gone) — the real, race-safe guard is
// still the atomic compare-and-swap in HandleBuyNow, re-checked from
// scratch (including the fee quote, quoteForListing) when the payment is
// actually resolved.
func HandleCreateCheckoutIntent(pool *pgxpool.Pool, paymentClient *payment.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		rail := order.RailCard
		if r.URL.Query().Get("rail") == "ach" {
			rail = order.RailAch
		}
		// Set only when the buyer explicitly picked a specific saved
		// card/bank in MockCheckout.tsx's picker (as opposed to just
		// letting their default auto-attach, the fallback below).
		chosenPaymentMethodID := r.URL.Query().Get("paymentMethodId")

		listingID := r.PathValue("id")
		lst, err := listing.Get(r.Context(), pool, listingID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, listing.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		if buyerID == lst.SellerID {
			http.Error(w, listing.ErrSelfPurchase.Error(), http.StatusForbidden)
			return
		}

		var subtotalCents int64
		switch {
		case lst.Format == listing.FormatFixed:
			if lst.BuyerID != nil {
				http.Error(w, listing.ErrAlreadySold.Error(), http.StatusConflict)
				return
			}
			if lst.PriceCents != nil {
				subtotalCents = *lst.PriceCents
			}

		// Won via regular bidding (not Buy It Now) and not yet paid —
		// ownership already resolved when the auction closed, so this is
		// purely a payment step (PayForWonAuction in buynow.go), at the
		// final winning bid amount. Checked before the BuyItNowPriceCents
		// case below so an auction that also happened to have a BIN price
		// still resolves to "pay what I won it for," not "buy it now."
		case lst.Outcome != nil && *lst.Outcome == "sold" &&
			lst.HighBidderID != nil && *lst.HighBidderID == buyerID:
			if lst.PaidAt != nil {
				http.Error(w, ErrAlreadyPaid.Error(), http.StatusConflict)
				return
			}
			if lst.CurrentPriceCents != nil {
				subtotalCents = *lst.CurrentPriceCents
			}

		case lst.BuyItNowPriceCents != nil:
			if lst.Outcome != nil {
				http.Error(w, ErrAuctionEnded.Error(), http.StatusConflict)
				return
			}
			subtotalCents = *lst.BuyItNowPriceCents

		default:
			http.Error(w, ErrNoBuyItNowPrice.Error(), http.StatusConflict)
			return
		}
		if subtotalCents <= 0 {
			http.Error(w, "listing has no purchasable price", http.StatusConflict)
			return
		}

		stripeAccountID, err := seller.RequirePayoutsEnabled(r.Context(), pool, lst.SellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if stripeAccountID == "" {
			// Deliberately NOT StatusConflict (409) — that's what "this
			// listing is already sold/ended" maps to on the frontend
			// (MockCheckout's AlreadyPurchasedNotice), and this is a
			// completely different condition (the seller hasn't finished
			// Connect onboarding) that needs its own distinct message.
			http.Error(w, ErrSellerNotOnboarded.Error(), http.StatusPreconditionFailed)
			return
		}

		// The listing's own preset is only the seller's listing-time floor —
		// resolve it against this specific sale's subtotal the same way
		// createOrderRecord does at capture time (shipping.UpgradePreset),
		// so the authorized amount and the eventually-recorded order amount
		// can never drift apart.
		resolvedPreset, _ := shipping.UpgradePreset(shipping.Preset(lst.ShippingPreset), subtotalCents)
		shippingCents := shipping.ChargedCents(resolvedPreset, lst.EstimatedShippingCents)

		quote, _, _, err := quoteForListing(r.Context(), pool, lst.SellerID, subtotalCents, shippingCents)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := checkoutIntentResponse{
			Rail:                string(rail),
			CardAmountCents:     int64(quote.CardTotal),
			BankAmountCents:     int64(quote.BankTotal),
			RealizedSavingCents: int64(quote.RealizedSaving),
			SellerFeeCents:      int64(quote.SellerFee),
			SellerNetCents:      int64(quote.SellerNet),
		}

		if rail == order.RailAch {
			// Auto-attach a saved bank account if there is one — either
			// whichever one the buyer explicitly picked in MockCheckout.tsx's
			// picker (chosenPaymentMethodID), or their default. Charged
			// directly on the platform account (this package's own doc
			// comment) — no cloning onto a connected account needed, the
			// buyer's platform-level Customer/PaymentMethod is exactly what
			// this PaymentIntent is created against.
			var paymentMethodID string
			var savedBank *paymentmethod.SavedBank
			platformCustomerID, bank, hasSaved, err := resolveBank(r.Context(), pool, paymentClient, buyerID, chosenPaymentMethodID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if hasSaved {
				paymentMethodID = bank.ID
				savedBank = bank
			}

			pi, err := paymentClient.CreateAchIntent(r.Context(), listingID, buyerID, int64(quote.BankTotal), paymentMethodID, platformCustomerID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			resp.ClientSecret = pi.ClientSecret
			resp.PaymentIntentID = pi.ID
			resp.AmountCents = int64(quote.BankTotal)
			resp.TaxCents = int64(quote.BankTax)
			resp.SavedBank = savedBank
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}

		// Auto-attach a saved card if there is one — either whichever one
		// the buyer explicitly picked in MockCheckout.tsx's picker
		// (chosenPaymentMethodID), or their default. Charged directly on
		// the platform account (this package's own doc comment) — the
		// buyer's platform-level Customer/PaymentMethod is exactly what
		// this PaymentIntent is created against, no cloning required.
		var paymentMethodID string
		var savedCard *paymentmethod.SavedCard
		platformCustomerID, card, hasSaved, err := resolveCard(r.Context(), pool, paymentClient, buyerID, chosenPaymentMethodID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if hasSaved {
			paymentMethodID = card.ID
			savedCard = card
		}

		pi, err := paymentClient.CreateIntent(r.Context(), listingID, buyerID, int64(quote.CardTotal), paymentMethodID, platformCustomerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp.ClientSecret = pi.ClientSecret
		resp.PaymentIntentID = pi.ID
		resp.AmountCents = int64(quote.CardTotal)
		resp.TaxCents = int64(quote.CardTax)
		resp.SavedCard = savedCard

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// resolveCard decides which of buyerID's platform-level saved cards (if
// any) this checkout should pre-attach: chosenID, if the buyer explicitly
// picked one in MockCheckout.tsx's picker (verified as actually theirs),
// otherwise their default. ok is false — never an error on its own — when
// there's simply nothing to pre-fill, either because chosenID belongs to
// someone else/doesn't exist (silently falls through rather than 500ing
// over a stale client-side id) or because the buyer has no saved cards at
// all.
func resolveCard(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, buyerID, chosenID string) (platformCustomerID string, card *paymentmethod.SavedCard, ok bool, err error) {
	if chosenID != "" {
		platformCustomerID, card, err = paymentmethod.Get(ctx, pool, paymentClient, buyerID, chosenID)
		if err != nil {
			if errors.Is(err, paymentmethod.ErrNotFound) {
				return "", nil, false, nil
			}
			return "", nil, false, err
		}
		return platformCustomerID, card, true, nil
	}
	return paymentmethod.DefaultCard(ctx, pool, paymentClient, buyerID)
}

// resolveBank is resolveCard's bank-account counterpart.
func resolveBank(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, buyerID, chosenID string) (platformCustomerID string, bank *paymentmethod.SavedBank, ok bool, err error) {
	if chosenID != "" {
		platformCustomerID, bank, err = paymentmethod.GetBank(ctx, pool, paymentClient, buyerID, chosenID)
		if err != nil {
			if errors.Is(err, paymentmethod.ErrNotFound) {
				return "", nil, false, nil
			}
			return "", nil, false, err
		}
		return platformCustomerID, bank, true, nil
	}
	return paymentmethod.DefaultBank(ctx, pool, paymentClient, buyerID)
}
