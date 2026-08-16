// Package payment wraps the Stripe SDK for the Buy It Now checkout flow —
// test-mode only for now (CLAUDE.md §5.1/§7: real money movement is on
// hold pending money-transmitter legal review; Stripe TEST keys don't
// touch that, they're free and unrestricted). See internal/auction's
// checkout.go for how this fits into the atomic purchase flow.
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
// stripeAccountID is the seller's Connect Express account id — a TRUE
// direct charge (design doc v2 §5.3): created directly on the connected
// account via the Stripe-Account header, so the seller is merchant of
// record and the money lands in their balance the instant it captures.
// This is deliberately NOT on_behalf_of/transfer_data (those are for
// destination charges, a different Connect charge type). Empty
// stripeAccountID falls back to a plain platform-account charge — only
// used by paths that predate Connect (none, after this phase lands, but
// kept so the method degrades safely rather than panicking on a zero
// value). applicationFeeCents is the platform's cut of THIS charge (seller
// fee + any tax being swept, design doc v2 §8) — zero omits the field
// entirely rather than sending an explicit 0. paymentMethodID, if set, is
// already scoped to stripeAccountID (see CloneSavedCardToConnectedAccount)
// — never a platform-level Customer's raw payment method id, which
// wouldn't exist on the connected account at all. connectedCustomerID must
// be set whenever paymentMethodID is: cloning a payment method that's
// already attached to a customer (every saved card is) makes Stripe attach
// the clone to a shadow Customer on the connected account too
// (CloneSavedCardToConnectedAccount's return value carries its id), and
// Stripe then requires that id back here on every PaymentIntent that reuses
// it — "the payment method you provided is attached to a customer so for
// security purposes you must provide the customer in the request" is the
// exact error otherwise, on every confirm attempt, not just the first,
// since nothing about the request changes between retries.
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
func (c *Client) CreateIntent(ctx context.Context, listingID, buyerID, stripeAccountID string, amountCents, applicationFeeCents int64, paymentMethodID, connectedCustomerID string) (pi *stripe.PaymentIntent, err error) {
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
	if connectedCustomerID != "" {
		params.Customer = stripe.String(connectedCustomerID)
	}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
		if applicationFeeCents > 0 {
			params.ApplicationFeeAmount = stripe.Int64(applicationFeeCents)
		}
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
func (c *Client) CreateAchIntent(ctx context.Context, listingID, buyerID, stripeAccountID string, amountCents, applicationFeeCents int64, paymentMethodID, connectedCustomerID string) (pi *stripe.PaymentIntent, err error) {
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
	if connectedCustomerID != "" {
		params.Customer = stripe.String(connectedCustomerID)
	}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
		if applicationFeeCents > 0 {
			params.ApplicationFeeAmount = stripe.Int64(applicationFeeCents)
		}
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
// swap in this codebase, CLAUDE.md §5.3). stripeAccountID must be the same
// connected account the intent was created on (direct-charge PaymentIntents
// only exist on the connected account — retrieving without it 404s).
func (c *Client) Retrieve(ctx context.Context, stripeAccountID, paymentIntentID string) (*stripe.PaymentIntent, error) {
	params := &stripe.PaymentIntentRetrieveParams{}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
	}
	pi, err := c.sc.V1PaymentIntents.Retrieve(ctx, paymentIntentID, params)
	if err != nil {
		return nil, fmt.Errorf("retrieve payment intent: %w", err)
	}
	return pi, nil
}

// Capture actually charges the authorized card — only ever called after
// the atomic purchase (listing.BuyNowFixed / auction.BuyNow) has already
// committed in our own database, i.e. this buyer has definitely won the
// listing.
func (c *Client) Capture(ctx context.Context, stripeAccountID, paymentIntentID string) error {
	params := &stripe.PaymentIntentCaptureParams{}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
	}
	if _, err := c.sc.V1PaymentIntents.Capture(ctx, paymentIntentID, params); err != nil {
		return fmt.Errorf("capture payment intent: %w", err)
	}
	return nil
}

// Cancel releases an authorization hold without charging the card — used
// when the atomic purchase lost the race (someone else already bought the
// listing) or failed validation. A buyer who didn't win the item is never
// charged for it.
func (c *Client) Cancel(ctx context.Context, stripeAccountID, paymentIntentID string) error {
	params := &stripe.PaymentIntentCancelParams{}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
	}
	if _, err := c.sc.V1PaymentIntents.Cancel(ctx, paymentIntentID, params); err != nil {
		return fmt.Errorf("cancel payment intent: %w", err)
	}
	return nil
}

// Refund fully refunds a captured direct charge by its PaymentIntent id —
// used by cmd/worker's ship-timeout and no-delivery-scan timers (design doc
// v2 §5.2) to actually return the buyer's money, not just flip the order's
// state and leave the charge standing. RefundApplicationFee is set so the
// platform's cut comes back too — a cancelled/refunded order should never
// leave the platform holding a fee for a sale that didn't happen.
func (c *Client) Refund(ctx context.Context, stripeAccountID, paymentIntentID string) error {
	params := &stripe.RefundCreateParams{
		PaymentIntent:        stripe.String(paymentIntentID),
		RefundApplicationFee: stripe.Bool(true),
	}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
	}
	if _, err := c.sc.V1Refunds.Create(ctx, params); err != nil {
		return fmt.Errorf("refund payment intent: %w", err)
	}
	return nil
}

// CreatePayout triggers an actual payout of amountCents from a seller's
// Stripe balance to their external bank account — the Payouts API call
// design doc v2 §6 describes as the platform's only real lever over a
// seller's money: "we are not operating escrow... payout timing on funds
// that already belong to the seller." Every connected account has its
// payout schedule set to manual at creation (internal/seller.
// CreateExpressAccount), so nothing pays out automatically — only this.
// method is "" (Stripe's own default, "standard") or "instant" — design
// doc v2 §6.3's paid instant-payout upsell.
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

// RefundAmount partially refunds a captured direct charge — the "keep it,
// take X% back" claims tool (design doc v2 §9.2). Unlike the full Refund
// above, this deliberately does NOT set RefundApplicationFee: a partial
// refund is a negotiated value adjustment on a sale that still happened
// (the seller shipped, the buyer kept the item), not a cancelled order, so
// the platform's fee for actually running that transaction stands.
func (c *Client) RefundAmount(ctx context.Context, stripeAccountID, paymentIntentID string, amountCents int64) error {
	params := &stripe.RefundCreateParams{
		PaymentIntent: stripe.String(paymentIntentID),
		Amount:        stripe.Int64(amountCents),
	}
	if stripeAccountID != "" {
		params.SetStripeAccount(stripeAccountID)
	}
	if _, err := c.sc.V1Refunds.Create(ctx, params); err != nil {
		return fmt.Errorf("refund payment intent amount: %w", err)
	}
	return nil
}

// ClonePaymentMethodToConnectedAccount copies a buyer's platform-level
// saved PaymentMethod — a card OR a bank account, the API call is
// identical either way — onto a seller's connected account, just-in-time
// at checkout. Required because a Stripe Customer/PaymentMethod lives on
// the PLATFORM account — it cannot be charged directly on a connected
// account at all, Stripe rejects it (design doc v2 §5.4). The clone is a
// one-time, per-transaction copy; the buyer's platform-level saved
// card/bank is what persists across purchases, not this clone.
// platformCustomerID (the buyer's PLATFORM Customer id — the one
// paymentmethod.DefaultCard/DefaultBank already looks up) MUST be passed
// here: Stripe requires proof of which customer the source payment method
// belongs to before it will clone one that's already attached to a
// customer (every saved card/bank is), and errors ("...for security
// purposes you must provide the customer in the request") if it's omitted
// — this bit us for real, see TASKS-TODO.md. In return, Stripe
// auto-creates a shadow Customer on the connected account and attaches the
// clone to it (the returned PaymentMethod's Customer field) — callers MUST
// pass that id (not platformCustomerID) into CreateIntent/CreateAchIntent's
// connectedCustomerID param, or the PaymentIntent creation succeeds but the
// resulting Payment Element fails to load client-side with the same
// underlying error. Deliberately scoped to just "attach this specific
// method to this specific intent" — a full "browse every saved method"
// Payment Element carousel on a connected-account intent would need a
// persistent (not per-transaction) shadow Customer per (buyer, seller)
// pair, which is out of scope here; our own frontend UI is what lets a
// buyer choose among several saved cards/banks instead (MockCheckout.tsx).
func (c *Client) ClonePaymentMethodToConnectedAccount(ctx context.Context, sourcePaymentMethodID, platformCustomerID, stripeAccountID string) (*stripe.PaymentMethod, error) {
	params := &stripe.PaymentMethodCreateParams{
		PaymentMethod: stripe.String(sourcePaymentMethodID),
		Customer:      stripe.String(platformCustomerID),
	}
	params.SetStripeAccount(stripeAccountID)
	pm, err := c.sc.V1PaymentMethods.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("clone payment method to connected account: %w", err)
	}
	return pm, nil
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
// BusinessType is pre-set to "individual" — nearly every seller here is a
// person selling their own cards, not a registered business, and without
// this Stripe's hosted onboarding stops to ask "individual or business?"
// as its own screen. Sellers who actually are a business can still change
// it during onboarding; this only pre-answers the common case, it doesn't
// lock anyone out of correcting it. profileURL (a seller's own AuctionHous
// profile page, when they've claimed a username — empty otherwise) plus a
// fixed ProductDescription are both set on BusinessProfile because Stripe
// only prompts a seller to enter their own business website if it has
// NEITHER a url nor a description of what's being sold — individual
// sellers on a P2P card marketplace essentially never have one, and
// shouldn't need to invent one just to get paid.
func (c *Client) CreateExpressAccount(ctx context.Context, email, profileURL string) (*stripe.Account, error) {
	params := &stripe.AccountCreateParams{
		Type:         stripe.String(string(stripe.AccountTypeExpress)),
		Email:        stripe.String(email),
		BusinessType: stripe.String("individual"),
		BusinessProfile: &stripe.AccountCreateBusinessProfileParams{
			ProductDescription: stripe.String("Trading card and collectibles sales on AuctionHous, a peer-to-peer marketplace"),
			// MCC 5945 ("Hobby, Toy, and Game Shops") is the standard
			// card-network category for trading card games and
			// collectibles — setting it here for every seller platform-
			// wide is what skips the interactive "Industry" question
			// during onboarding entirely (Stripe only asks when it can't
			// already tell). Without this, the card_payments capability
			// request below (needed for charges to work at all) pulls in
			// "What's your industry?" as a real, unavoidable-looking
			// requirement for someone who's just trying to get paid for
			// selling a card — same class of friction as the "website"
			// question §6.13 already fixed via ProductDescription/URL.
			MCC: stripe.String("5945"),
		},
		Settings: &stripe.AccountCreateSettingsParams{
			Payouts: &stripe.AccountCreateSettingsPayoutsParams{
				Schedule: &stripe.AccountCreateSettingsPayoutsScheduleParams{
					Interval: stripe.String("manual"),
				},
			},
			// Same reasoning as MCC above: without a platform-wide
			// default, card_payments requires each individual seller to
			// invent their own statement descriptor (what shows on a
			// buyer's card statement) — a "make up a business name"
			// question that has no business being asked of someone
			// selling one Charizard. One shared descriptor across every
			// seller (must be 5-22 chars, letters/spaces only, no
			// <>'"*) is exactly how ordinary marketplaces (eBay, Etsy,
			// StockX) handle this — the buyer sees "AUCTIONHOUS TCG" on
			// their statement regardless of which individual sold them
			// the card, the same way they'd see "ETSY.COM" regardless of
			// which Etsy shop they bought from.
			Payments: &stripe.AccountCreateSettingsPaymentsParams{
				StatementDescriptor: stripe.String("AUCTIONHOUS TCG"),
			},
		},
		// Without explicitly requesting these, Stripe only granted this
		// account "transfers" (needed for payouts) and left card_payments
		// off entirely — direct charges (design doc v2 §5.3) then fail at
		// confirm time with "You cannot create a charge on a connected
		// account without the `card_payments` capability enabled," a real
		// bug caught live: every listing created against an account from
		// before this fix can take bids/authorize a checkout-intent fine
		// (that part never touches capabilities) but can't actually be
		// paid for. us_bank_account_ach_payments is the ACH-rail
		// equivalent (design doc v2 §4) — same reasoning, same fix.
		Capabilities: &stripe.AccountCreateCapabilitiesParams{
			CardPayments:             &stripe.AccountCreateCapabilitiesCardPaymentsParams{Requested: stripe.Bool(true)},
			Transfers:                &stripe.AccountCreateCapabilitiesTransfersParams{Requested: stripe.Bool(true)},
			USBankAccountACHPayments: &stripe.AccountCreateCapabilitiesUSBankAccountACHPaymentsParams{Requested: stripe.Bool(true)},
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
