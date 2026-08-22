// Package payment wraps the Stripe SDK for the Buy It Now checkout flow —
// test-mode only for now (CLAUDE.md §5.1/§7: real money movement is on
// hold pending money-transmitter legal review; Stripe TEST keys don't
// touch that, they're free and unrestricted). See internal/auction's
// checkout.go for how this fits into the atomic purchase flow.
//
// Charges are "separate charges and transfers" (docs/Legal_MoneyTransitter.md),
// not direct charges: every PaymentIntent below is created on the PLATFORM's
// own Stripe account — the buyer's card is charged there, and the money sits
// in the platform's own balance for as long as the order sits in escrow.
// Money only ever reaches a seller's connected account via an explicit
// CreateTransfer call, made once (internal/order.ReleaseFunds) when an order
// actually reaches the released state — never automatically at charge time.
// This is what keeps the legal story from docs/Legal_MoneyTransitter.md
// intact: funds never leave Stripe's own ledger until they resolve to
// exactly one of two destinations (the seller, on release, or the buyer, on
// refund), and a seller's connected account never independently holds a
// balance beyond what's already been released to them.
package payment

import (
	"context"
	"fmt"

	"github.com/stripe/stripe-go/v82"
)

// Client is nil when STRIPE_SECRET_KEY isn't set — same graceful-
// degradation pattern as Supabase (CLAUDE.md §6.12): callers check
// IsConfigured() and fall back to the no-Stripe mock-payment path rather
// than failing to boot.
type Client struct {
	sc *stripe.Client
}

func NewClient(secretKey string) *Client {
	if secretKey == "" {
		return nil
	}
	return &Client{sc: stripe.NewClient(secretKey)}
}

func (c *Client) IsConfigured() bool {
	return c != nil
}

// CreateIntent authorizes — but does not capture — amountCents against a
// card for a prospective purchase of listingID by buyerID. capture_method
// is "manual" specifically so that authorizing a card, and even
// confirming it client-side, never actually moves money or touches the
// listing: only a later Capture call (made after this buyer has already
// won the atomic compare-and-swap in our own database) does that. This is
// what lets two buyers safely authorize a card for the same listing at the
// same time — the loser's hold gets Cancel'd, never charged.
//
// Created entirely on the PLATFORM account — no Stripe-Account header, no
// connected-account context at all. This is a "separate charges and
// transfers" flow, not a direct charge: the seller isn't merchant of
// record, and the money lands in the platform's own balance, not theirs
// (see this package's doc comment). paymentMethodID/customerID are the
// buyer's own PLATFORM-level saved payment method and Customer id
// (internal/paymentmethod) — charged directly, no cloning onto a connected
// account required, since there's no connected-account context to clone
// onto anymore.
//
// PaymentMethodTypes is pinned to just "card" — deliberately NOT
// AutomaticPaymentMethods, which was the original implementation and a
// real bug: with it enabled, Stripe (via Link) can surface a buyer's
// linked BANK account as an option on this, the card-rail intent, which
// directly contradicts the "Pay by card" tab the buyer just chose and the
// separate, already-built "Pay by bank instead" tab (CreateAchIntent,
// below) sitting right next to it — a "transparency by default" violation
// (CLAUDE.md's brand value) since fee/rail framing is exactly what design
// doc v2 §2.7 says must never be ambiguous. Pinning this the same way
// CreateAchIntent already pins itself to "us_bank_account" keeps the two
// rails' Payment Elements strictly non-overlapping.
func (c *Client) CreateIntent(ctx context.Context, listingID, buyerID string, amountCents int64, paymentMethodID, customerID string) (pi *stripe.PaymentIntent, err error) {
	params := &stripe.PaymentIntentCreateParams{
		Amount:             stripe.Int64(amountCents),
		Currency:           stripe.String(string(stripe.CurrencyUSD)),
		CaptureMethod:      stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
		PaymentMethodTypes: []*string{stripe.String("card")},
		Metadata: map[string]string{
			"listing_id": listingID,
			"buyer_id":   buyerID,
		},
	}
	if paymentMethodID != "" {
		params.PaymentMethod = stripe.String(paymentMethodID)
	}
	if customerID != "" {
		params.Customer = stripe.String(customerID)
	}
	pi, err = c.sc.V1PaymentIntents.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create payment intent: %w", err)
	}
	return pi, nil
}

// CreateAchIntent authorizes an ACH Direct Debit charge — the discount
// rail (design doc v2 §4). Unlike CreateIntent, this does NOT set
// CaptureMethod: manual — us_bank_account doesn't support manual capture
// at all, only automatic. That does not reopen the double-sale race
// CaptureMethod:manual exists to close for cards: an ACH PaymentIntent
// sits in "processing" for up to 4 business days before funds actually
// move (design doc v2 §4's whole premise — that window is what makes this
// safe), and Stripe explicitly permits canceling a PaymentIntent while
// it's in "processing" for exactly this class of delayed-notification
// payment method. So the flow is identical in shape to the card rail:
// authorize (this function, confirmed client-side) -> atomic ownership
// compare-and-swap -> the loser's intent gets Cancel'd (works while
// processing) -> the winner's is simply left alone, since it's already
// auto-capturing. No separate "Capture" call exists for this rail — see
// internal/auction/buynow.go for how the winner's path branches on this.
// paymentMethodID/connectedCustomerID, if set, are a saved bank account
// the buyer has already linked (internal/paymentmethod), cloned onto this
// connected account just-in-time the same way a saved card is (see
// ClonePaymentMethodToConnectedAccount) — pre-attaching it here is what
// lets a returning buyer skip re-linking their bank through Financial
// Connections on every purchase. When both are empty, a bank account is
// linked interactively through the Payment Element (Financial Connections
// embedded in Elements) at confirm time instead.
//
// Known gap, not implemented here: design doc v2 §4.1's balance check
// ("retrieve available balance via Financial Connections before confirming;
// reject if balance < total") needs a Financial Connections Account
// retrieval sandwiched between the bank getting linked and the intent
// being confirmed — both client-side steps this backend function doesn't
// participate in. Flagged rather than silently skipped; a client that
// confirms with insufficient funds today just gets a real ACH return days
// later instead of an instant rejection.
//
// Created on the PLATFORM account, same reasoning as CreateIntent above —
// no connected-account context, no cloning, the buyer's own saved bank
// account is charged directly.
func (c *Client) CreateAchIntent(ctx context.Context, listingID, buyerID string, amountCents int64, paymentMethodID, customerID string) (pi *stripe.PaymentIntent, err error) {
	params := &stripe.PaymentIntentCreateParams{
		Amount:             stripe.Int64(amountCents),
		Currency:           stripe.String(string(stripe.CurrencyUSD)),
		PaymentMethodTypes: []*string{stripe.String("us_bank_account")},
		Metadata: map[string]string{
			"listing_id": listingID,
			"buyer_id":   buyerID,
		},
	}
	if paymentMethodID != "" {
		params.PaymentMethod = stripe.String(paymentMethodID)
	}
	if customerID != "" {
		params.Customer = stripe.String(customerID)
	}
	pi, err = c.sc.V1PaymentIntents.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create ach payment intent: %w", err)
	}
	return pi, nil
}

// Retrieve fetches the current PaymentIntent state — used to verify a
// client-supplied paymentIntentId actually belongs to this listing/buyer
// and is genuinely authorized before trusting it for anything (never trust
// client-supplied state for something that moves money; always re-check
// server-side, the same principle as every other race-safe compare-and-
// swap in this codebase, CLAUDE.md §5.3). Always the platform account now —
// separate-charges-and-transfers PaymentIntents only ever exist there.
func (c *Client) Retrieve(ctx context.Context, paymentIntentID string) (*stripe.PaymentIntent, error) {
	pi, err := c.sc.V1PaymentIntents.Retrieve(ctx, paymentIntentID, &stripe.PaymentIntentRetrieveParams{})
	if err != nil {
		return nil, fmt.Errorf("retrieve payment intent: %w", err)
	}
	return pi, nil
}

// Capture actually charges the authorized card — only ever called after
// the atomic purchase (listing.BuyNowFixed / auction.BuyNow) has already
// committed in our own database, i.e. this buyer has definitely won the
// listing. Returns the captured PaymentIntent (with LatestCharge expanded)
// so the caller can record the resulting charge id on the order —
// internal/order.ReleaseFunds doesn't need it (a plain balance-drawing
// Transfer is enough at this volume), but it's useful provenance to have on
// the order row regardless.
func (c *Client) Capture(ctx context.Context, paymentIntentID string) (*stripe.PaymentIntent, error) {
	pi, err := c.sc.V1PaymentIntents.Capture(ctx, paymentIntentID, &stripe.PaymentIntentCaptureParams{
		Expand: []*string{stripe.String("latest_charge")},
	})
	if err != nil {
		return nil, fmt.Errorf("capture payment intent: %w", err)
	}
	return pi, nil
}

// Cancel releases an authorization hold without charging the card — used
// when the atomic purchase lost the race (someone else already bought the
// listing) or failed validation. A buyer who didn't win the item is never
// charged for it.
func (c *Client) Cancel(ctx context.Context, paymentIntentID string) error {
	if _, err := c.sc.V1PaymentIntents.Cancel(ctx, paymentIntentID, &stripe.PaymentIntentCancelParams{}); err != nil {
		return fmt.Errorf("cancel payment intent: %w", err)
	}
	return nil
}

// Refund fully refunds a captured platform-side charge by its PaymentIntent
// id — used by cmd/worker's ship-timeout and no-delivery-scan timers
// (design doc v2 §5.2) to actually return the buyer's money, not just flip
// the order's state and leave the charge standing. No RefundApplicationFee
// flag anymore (that was a direct-charge concept) — under separate charges
// and transfers there's no separate application-fee object to reverse: the
// whole charge lived on the platform's own balance, so a full refund simply
// returns all of it, and since no Transfer to the seller has happened yet
// at any point a full refund is legal (see internal/order's transition
// table — refunded is only reachable from states before release), there's
// nothing on the seller's side to claw back either.
func (c *Client) Refund(ctx context.Context, paymentIntentID string) error {
	if _, err := c.sc.V1Refunds.Create(ctx, &stripe.RefundCreateParams{
		PaymentIntent: stripe.String(paymentIntentID),
	}); err != nil {
		return fmt.Errorf("refund payment intent: %w", err)
	}
	return nil
}

// CreatePayout triggers an actual payout of amountCents from a seller's
// Stripe balance to their external bank account — the second and final
// leg of the money's journey, only ever meaningful after CreateTransfer
// below has actually moved that amount into the seller's connected-account
// balance (a released order's funds sit in the PLATFORM's balance until
// then, per this package's doc comment — they are never in the seller's
// balance a moment earlier). Every connected account has its payout
// schedule set to manual at creation (internal/seller.CreateExpressAccount),
// so nothing pays out automatically — only this. method is "" (Stripe's own
// default, "standard") or "instant" — design doc v2 §6.3's paid
// instant-payout upsell.
func (c *Client) CreatePayout(ctx context.Context, stripeAccountID string, amountCents int64, method string) (*stripe.Payout, error) {
	params := &stripe.PayoutCreateParams{
		Amount:   stripe.Int64(amountCents),
		Currency: stripe.String(string(stripe.CurrencyUSD)),
	}
	if method != "" {
		params.Method = stripe.String(method)
	}
	params.SetStripeAccount(stripeAccountID)
	payout, err := c.sc.V1Payouts.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create payout: %w", err)
	}
	return payout, nil
}

// CreateTransfer moves amountCents from the platform's own Stripe balance
// into a seller's connected account — the one and only point in this whole
// flow where money actually leaves the platform's ledger toward a seller,
// called exactly once per order by internal/order.ReleaseFunds, exactly
// when that order reaches the released state (claim window elapsed, a
// trusted-tier seller's instant release, or a claim resolving in the
// seller's favor). This is what makes "separate charges and transfers" the
// right charge type for the legal shape docs/Legal_MoneyTransitter.md
// describes: unlike a destination charge (where the transfer happens
// automatically the instant the charge captures), nothing moves toward the
// seller until the platform explicitly decides the hold is over.
func (c *Client) CreateTransfer(ctx context.Context, stripeAccountID string, amountCents int64) (*stripe.Transfer, error) {
	tr, err := c.sc.V1Transfers.Create(ctx, &stripe.TransferCreateParams{
		Amount:      stripe.Int64(amountCents),
		Currency:    stripe.String(string(stripe.CurrencyUSD)),
		Destination: stripe.String(stripeAccountID),
	})
	if err != nil {
		return nil, fmt.Errorf("create transfer: %w", err)
	}
	return tr, nil
}

// RefundAmount partially refunds a captured platform-side charge — the
// "keep it, take X% back" claims tool (design doc v2 §9.2). Comes entirely
// out of the seller's eventual take, never the platform's fee: a partial
// refund is a negotiated value adjustment on a sale that still happened
// (the seller shipped, the buyer kept the item), not a cancelled order, so
// the platform's fee for actually running that transaction stands. Callers
// (internal/dispute.executePartialRefund) are responsible for recording the
// refunded amount on the order (orders.refunded_cents) so
// internal/order.ReleaseFunds transfers seller_net_cents minus whatever's
// already gone back to the buyer, never the full pre-refund amount.
func (c *Client) RefundAmount(ctx context.Context, paymentIntentID string, amountCents int64) error {
	if _, err := c.sc.V1Refunds.Create(ctx, &stripe.RefundCreateParams{
		PaymentIntent: stripe.String(paymentIntentID),
		Amount:        stripe.Int64(amountCents),
	}); err != nil {
		return fmt.Errorf("refund payment intent amount: %w", err)
	}
	return nil
}

// --- Saved cards ("Save a Card" in Account Settings) ---
//
// A Stripe Customer is created lazily, once, per user (see
// internal/paymentmethod, which owns mapping a user id to a customer id in
// our own database) — everything below operates on that customer id.
// Actual card numbers never touch our backend or database at all; only
// Stripe's customer/payment-method ids do.

// CreateCustomer creates a new Stripe Customer — called once per user, the
// first time they try to save a card.
func (c *Client) CreateCustomer(ctx context.Context, email string) (*stripe.Customer, error) {
	cust, err := c.sc.V1Customers.Create(ctx, &stripe.CustomerCreateParams{
		Email: stripe.String(email),
	})
	if err != nil {
		return nil, fmt.Errorf("create customer: %w", err)
	}
	return cust, nil
}

// RetrieveCustomer fetches a Customer — used to read which saved card (if
// any) is currently its default.
func (c *Client) RetrieveCustomer(ctx context.Context, customerID string) (*stripe.Customer, error) {
	cust, err := c.sc.V1Customers.Retrieve(ctx, customerID, nil)
	if err != nil {
		return nil, fmt.Errorf("retrieve customer: %w", err)
	}
	return cust, nil
}

// SetDefaultPaymentMethod marks paymentMethodID as customerID's default —
// what "the" saved card means once a customer has more than one, and
// which card checkout automatically uses.
func (c *Client) SetDefaultPaymentMethod(ctx context.Context, customerID, paymentMethodID string) error {
	_, err := c.sc.V1Customers.Update(ctx, customerID, &stripe.CustomerUpdateParams{
		InvoiceSettings: &stripe.CustomerUpdateInvoiceSettingsParams{
			DefaultPaymentMethod: stripe.String(paymentMethodID),
		},
	})
	if err != nil {
		return fmt.Errorf("set default payment method: %w", err)
	}
	return nil
}

// CreateSetupIntent authorizes saving a new payment method for customerID
// for future reuse, without charging anything — the "Save a Card"/"Link a
// bank account" forms in Account Settings and inline at checkout.
// pmType is "card" or "us_bank_account", pinned explicitly (NOT
// AutomaticPaymentMethods, the original implementation) for the same
// reason CreateIntent pins itself to "card" only: a buyer who clicked
// "Add a card" should only ever be shown card fields, never Link
// surfacing an unrelated linked bank account on top, and vice versa for
// "Link a bank account" — see CreateIntent's doc comment and
// TASKS-TODO.md for the "Pay by card showed a bank picker" bug this
// pattern fixes.
func (c *Client) CreateSetupIntent(ctx context.Context, customerID, pmType string) (*stripe.SetupIntent, error) {
	si, err := c.sc.V1SetupIntents.Create(ctx, &stripe.SetupIntentCreateParams{
		Customer:           stripe.String(customerID),
		PaymentMethodTypes: []*string{stripe.String(pmType)},
	})
	if err != nil {
		return nil, fmt.Errorf("create setup intent: %w", err)
	}
	return si, nil
}

// ListSavedCards returns every card PaymentMethod attached to customerID.
func (c *Client) ListSavedCards(ctx context.Context, customerID string) ([]*stripe.PaymentMethod, error) {
	return c.listPaymentMethods(ctx, customerID, stripe.PaymentMethodTypeCard)
}

// ListSavedBanks returns every bank account PaymentMethod attached to
// customerID — the "Linked Bank Accounts" list in Account Settings and the
// saved-method picker on checkout's "Pay by bank instead" tab.
func (c *Client) ListSavedBanks(ctx context.Context, customerID string) ([]*stripe.PaymentMethod, error) {
	return c.listPaymentMethods(ctx, customerID, stripe.PaymentMethodTypeUSBankAccount)
}

func (c *Client) listPaymentMethods(ctx context.Context, customerID string, pmType stripe.PaymentMethodType) ([]*stripe.PaymentMethod, error) {
	var out []*stripe.PaymentMethod
	for pm, err := range c.sc.V1PaymentMethods.List(ctx, &stripe.PaymentMethodListParams{
		Customer: stripe.String(customerID),
		Type:     stripe.String(string(pmType)),
	}) {
		if err != nil {
			return nil, fmt.Errorf("list payment methods: %w", err)
		}
		out = append(out, pm)
	}
	return out, nil
}

// DetachPaymentMethod removes a saved card from its customer entirely —
// "Remove" in Account Settings.
func (c *Client) DetachPaymentMethod(ctx context.Context, paymentMethodID string) error {
	if _, err := c.sc.V1PaymentMethods.Detach(ctx, paymentMethodID, nil); err != nil {
		return fmt.Errorf("detach payment method: %w", err)
	}
	return nil
}

// RetrievePaymentMethod fetches a single PaymentMethod — used to verify a
// paymentMethodID actually belongs to the customer requesting to
// set-default/delete it before acting on it.
func (c *Client) RetrievePaymentMethod(ctx context.Context, paymentMethodID string) (*stripe.PaymentMethod, error) {
	pm, err := c.sc.V1PaymentMethods.Retrieve(ctx, paymentMethodID, nil)
	if err != nil {
		return nil, fmt.Errorf("retrieve payment method: %w", err)
	}
	return pm, nil
}

// --- Stripe Connect (seller Express accounts, design doc v2 §5.1/§7) ---
//
// A Connect account is a seller's merchant identity — money from a direct
// charge lands in their balance, not ours. Deliberately kept distinct from
// the Customer id above (a buyer's saved-card identity): the same person
// can be both.

// CreateExpressAccount creates a new Stripe Connect Express account for a
// seller and sets its payout schedule to manual at creation time (design
// doc v2 §6.1 requires this — the platform controls *when* Payouts API
// calls fire, batched weekly by default; it never controls custody).
//
// Only the "transfers" capability is requested — under separate charges and
// transfers (this package's doc comment), a seller's connected account
// never charges a buyer's card itself; it only ever RECEIVES a Transfer
// from the platform's balance and pays that out to its own bank. That's
// deliberate, not just simpler: requesting card_payments (the original
// direct-charge design) makes Stripe's hosted onboarding collect a full
// individual KYC packet — legal address, DOB, SSN, phone — AND a
// business-style statement descriptor for every single seller, on the
// theory that each one is independently charging cards as their own
// merchant. A seller who's just paid out via Transfer never needs any of
// that (docs/Legal_MoneyTransitter.md's whole point: the PLATFORM is
// merchant of record, not them) — requesting transfers alone is both the
// legally-correct shape and, not incidentally, the version of onboarding
// that doesn't make someone selling one Charizard invent a business name.
//
// BusinessType is pre-set to "individual" — nearly every seller here is a
// person selling their own cards, not a registered business, and without
// this Stripe's hosted onboarding stops to ask "individual or business?"
// as its own screen. Sellers who actually are a business can still change
// it during onboarding; this only pre-answers the common case, it doesn't
// lock anyone out of correcting it. profileURL (a seller's own AuctionHous
// profile page, when they've claimed a username — empty otherwise) plus a
// fixed ProductDescription are both set on BusinessProfile because Stripe
// only prompts a seller to enter their own business website if it has
// NEITHER a url nor a description of what's being sold.
func (c *Client) CreateExpressAccount(ctx context.Context, email, profileURL string) (*stripe.Account, error) {
	params := &stripe.AccountCreateParams{
		Type:         stripe.String(string(stripe.AccountTypeExpress)),
		Email:        stripe.String(email),
		BusinessType: stripe.String("individual"),
		BusinessProfile: &stripe.AccountCreateBusinessProfileParams{
			ProductDescription: stripe.String("Trading card and collectibles sales on AuctionHous, a peer-to-peer marketplace"),
		},
		Settings: &stripe.AccountCreateSettingsParams{
			Payouts: &stripe.AccountCreateSettingsPayoutsParams{
				Schedule: &stripe.AccountCreateSettingsPayoutsScheduleParams{
					Interval: stripe.String("manual"),
				},
			},
		},
		Capabilities: &stripe.AccountCreateCapabilitiesParams{
			Transfers: &stripe.AccountCreateCapabilitiesTransfersParams{Requested: stripe.Bool(true)},
		},
	}
	if profileURL != "" {
		params.BusinessProfile.URL = stripe.String(profileURL)
	}
	acct, err := c.sc.V1Accounts.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create express account: %w", err)
	}
	return acct, nil
}

// CreateAccountLink creates a Stripe-hosted onboarding link for accountID —
// the seller is redirected there to submit identity/bank details, then
// back to returnURL (or refreshURL if the link expired mid-flow). Onboarding
// completion is only ever trusted via the account.updated webhook (see
// internal/webhook), never a client-side "I'm done" claim landing on
// returnURL.
func (c *Client) CreateAccountLink(ctx context.Context, accountID, returnURL, refreshURL string) (*stripe.AccountLink, error) {
	link, err := c.sc.V1AccountLinks.Create(ctx, &stripe.AccountLinkCreateParams{
		Account:    stripe.String(accountID),
		Type:       stripe.String("account_onboarding"),
		ReturnURL:  stripe.String(returnURL),
		RefreshURL: stripe.String(refreshURL),
	})
	if err != nil {
		return nil, fmt.Errorf("create account link: %w", err)
	}
	return link, nil
}

// CreateCustomerSession authorizes the checkout page's Payment Element to
// show customerID's saved cards as selectable options — alongside every
// other payment method type (Klarna, Cashapp, a brand new card, etc.) —
// with the PaymentIntent's attached default card pre-selected. Without
// this, the Payment Element never displays saved payment methods at all,
// no matter what's attached to the PaymentIntent itself; this is the
// separate opt-in Stripe requires for it.
func (c *Client) CreateCustomerSession(ctx context.Context, customerID string) (*stripe.CustomerSession, error) {
	cs, err := c.sc.V1CustomerSessions.Create(ctx, &stripe.CustomerSessionCreateParams{
		Customer: stripe.String(customerID),
		Components: &stripe.CustomerSessionCreateComponentsParams{
			PaymentElement: &stripe.CustomerSessionCreateComponentsPaymentElementParams{
				Enabled: stripe.Bool(true),
				Features: &stripe.CustomerSessionCreateComponentsPaymentElementFeaturesParams{
					PaymentMethodRedisplay: stripe.String("enabled"),
					// Stripe's own default here is ["always"] — but a card
					// saved via a plain SetupIntent confirm (CreateSetupIntent
					// below) comes back with allow_redisplay "unspecified",
					// not "always", so the default filter silently hides
					// every card this app ever saves. Widening it to every
					// value is what actually makes a saved card show up at
					// checkout at all.
					PaymentMethodAllowRedisplayFilters: []*string{
						stripe.String("always"),
						stripe.String("limited"),
						stripe.String("unspecified"),
					},
				},
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create customer session: %w", err)
	}
	return cs, nil
}
