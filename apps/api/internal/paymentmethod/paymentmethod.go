// Package paymentmethod backs "Save a Card" and "Link a Bank Account" in
// Account Settings — a lazily-created Stripe Customer per user (users.
// stripe_customer_id, migration 0018), so a saved test card/bank account
// can be reused at checkout instead of re-entering it every time. Actual
// card numbers and bank account numbers never touch our backend or
// database — only Stripe's customer/payment-method ids do.
package paymentmethod

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/user"
)

var ErrNotFound = errors.New("saved payment method not found")

// SavedCard is the frontend-facing shape of a saved card — brand/last4/
// expiry only, mirroring what Stripe itself shows on a receipt. Never any
// more than that; the card number itself was never sent to us at all.
type SavedCard struct {
	ID        string `json:"id"`
	Brand     string `json:"brand"`
	Last4     string `json:"last4"`
	ExpMonth  int64  `json:"expMonth"`
	ExpYear   int64  `json:"expYear"`
	IsDefault bool   `json:"isDefault"`
}

// SavedBank is the frontend-facing shape of a linked bank account —
// institution name and last4 only, same "never more than a receipt shows"
// principle as SavedCard. The buyer links it by logging into their real
// bank through Stripe's Financial Connections (embedded in the Payment
// Element) — we never see routing/account numbers or bank credentials.
type SavedBank struct {
	ID        string `json:"id"`
	BankName  string `json:"bankName"`
	Last4     string `json:"last4"`
	IsDefault bool   `json:"isDefault"`
}

func toSavedCard(pm *stripe.PaymentMethod, defaultID string) SavedCard {
	card := SavedCard{ID: pm.ID, IsDefault: pm.ID == defaultID}
	if pm.Card != nil {
		card.Brand = string(pm.Card.Brand)
		card.Last4 = pm.Card.Last4
		card.ExpMonth = pm.Card.ExpMonth
		card.ExpYear = pm.Card.ExpYear
	}
	return card
}

func toSavedBank(pm *stripe.PaymentMethod, defaultID string) SavedBank {
	bank := SavedBank{ID: pm.ID, IsDefault: pm.ID == defaultID}
	if pm.USBankAccount != nil {
		bank.BankName = pm.USBankAccount.BankName
		bank.Last4 = pm.USBankAccount.Last4
	}
	return bank
}

func existingCustomerID(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	var id *string
	if err := pool.QueryRow(ctx, `select stripe_customer_id from users where id = $1`, userID).Scan(&id); err != nil {
		return "", fmt.Errorf("read stripe customer id: %w", err)
	}
	if id == nil {
		return "", nil
	}
	return *id, nil
}

// EnsureCustomer returns userID's Stripe customer id, creating one (and
// storing it) the first time this is called for them — every subsequent
// call is just a DB read, no Stripe API call at all.
func EnsureCustomer(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (string, error) {
	if existing, err := existingCustomerID(ctx, pool, userID); err != nil {
		return "", err
	} else if existing != "" {
		return existing, nil
	}

	u, err := user.Get(ctx, pool, userID)
	if err != nil {
		return "", fmt.Errorf("get user: %w", err)
	}
	cust, err := paymentClient.CreateCustomer(ctx, u.Email)
	if err != nil {
		return "", err
	}
	if _, err := pool.Exec(ctx, `update users set stripe_customer_id = $1 where id = $2`, cust.ID, userID); err != nil {
		return "", fmt.Errorf("store stripe customer id: %w", err)
	}
	return cust.ID, nil
}

// customerDefault reads userID's Stripe customer id and current default
// PaymentMethod id (empty string if there is no customer yet, or no
// default set) — the one piece shared by every List*/Default* pair below.
func customerDefault(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (customerID, defaultID string, err error) {
	customerID, err = existingCustomerID(ctx, pool, userID)
	if err != nil || customerID == "" {
		return customerID, "", err
	}
	cust, err := paymentClient.RetrieveCustomer(ctx, customerID)
	if err != nil {
		return "", "", err
	}
	if cust.InvoiceSettings != nil && cust.InvoiceSettings.DefaultPaymentMethod != nil {
		defaultID = cust.InvoiceSettings.DefaultPaymentMethod.ID
	}
	return customerID, defaultID, nil
}

// List returns every card userID has saved — an empty (not nil) slice if
// they've never saved one at all, which is the common case and not an
// error.
func List(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) ([]SavedCard, error) {
	customerID, defaultID, err := customerDefault(ctx, pool, paymentClient, userID)
	if err != nil || customerID == "" {
		return []SavedCard{}, err
	}
	pms, err := paymentClient.ListSavedCards(ctx, customerID)
	if err != nil {
		return nil, err
	}
	out := make([]SavedCard, len(pms))
	for i, pm := range pms {
		out[i] = toSavedCard(pm, defaultID)
	}
	return out, nil
}

// ListBanks is List's bank-account counterpart — every bank account
// userID has linked, empty (not nil) slice if none yet.
func ListBanks(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) ([]SavedBank, error) {
	customerID, defaultID, err := customerDefault(ctx, pool, paymentClient, userID)
	if err != nil || customerID == "" {
		return []SavedBank{}, err
	}
	pms, err := paymentClient.ListSavedBanks(ctx, customerID)
	if err != nil {
		return nil, err
	}
	out := make([]SavedBank, len(pms))
	for i, pm := range pms {
		out[i] = toSavedBank(pm, defaultID)
	}
	return out, nil
}

// DefaultCard returns userID's Stripe customer id and default saved card —
// what checkout auto-attaches so the buyer doesn't have to retype a card
// when they haven't explicitly picked a different saved one (see Get).
// ok is false (never an error) when the user has never saved a card at
// all; that's the normal "nothing to auto-fill" case, not a failure.
func DefaultCard(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (customerID string, card *SavedCard, ok bool, err error) {
	cards, err := List(ctx, pool, paymentClient, userID)
	if err != nil || len(cards) == 0 {
		return "", nil, false, err
	}
	customerID, err = existingCustomerID(ctx, pool, userID)
	if err != nil {
		return "", nil, false, err
	}
	for _, c := range cards {
		if c.IsDefault {
			cc := c
			return customerID, &cc, true, nil
		}
	}
	// Has saved cards but somehow none marked default (shouldn't happen —
	// CreateSetupIntentSecret's first save and SetDefault always set one)
	// — fall back to the first rather than surfacing nothing to use.
	return customerID, &cards[0], true, nil
}

// DefaultBank is DefaultCard's bank-account counterpart.
func DefaultBank(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (customerID string, bank *SavedBank, ok bool, err error) {
	banks, err := ListBanks(ctx, pool, paymentClient, userID)
	if err != nil || len(banks) == 0 {
		return "", nil, false, err
	}
	customerID, err = existingCustomerID(ctx, pool, userID)
	if err != nil {
		return "", nil, false, err
	}
	for _, b := range banks {
		if b.IsDefault {
			bb := b
			return customerID, &bb, true, nil
		}
	}
	return customerID, &banks[0], true, nil
}

// Get returns one specific saved card of userID's, verifying ownership
// first — how checkout attaches whichever saved card the buyer explicitly
// picked in MockCheckout.tsx's picker (as opposed to DefaultCard, used
// when they haven't chosen one yet).
func Get(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, paymentMethodID string) (customerID string, card *SavedCard, err error) {
	customerID, defaultID, err := customerDefault(ctx, pool, paymentClient, userID)
	if err != nil {
		return "", nil, err
	}
	if customerID == "" {
		return "", nil, ErrNotFound
	}
	pm, err := paymentClient.RetrievePaymentMethod(ctx, paymentMethodID)
	if err != nil {
		return "", nil, err
	}
	if pm.Customer == nil || pm.Customer.ID != customerID {
		return "", nil, ErrNotFound
	}
	c := toSavedCard(pm, defaultID)
	return customerID, &c, nil
}

// GetBank is Get's bank-account counterpart.
func GetBank(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, paymentMethodID string) (customerID string, bank *SavedBank, err error) {
	customerID, defaultID, err := customerDefault(ctx, pool, paymentClient, userID)
	if err != nil {
		return "", nil, err
	}
	if customerID == "" {
		return "", nil, ErrNotFound
	}
	pm, err := paymentClient.RetrievePaymentMethod(ctx, paymentMethodID)
	if err != nil {
		return "", nil, err
	}
	if pm.Customer == nil || pm.Customer.ID != customerID {
		return "", nil, ErrNotFound
	}
	b := toSavedBank(pm, defaultID)
	return customerID, &b, nil
}

// CreateSetupIntentSecret authorizes saving a new card for userID for
// future reuse, without charging anything — backs the "Add a card" form
// in Account Settings and checkout's inline "Save Card for future use".
// Ensures a Stripe customer exists first (lazily creating one on a user's
// very first saved card).
func CreateSetupIntentSecret(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (string, error) {
	customerID, err := EnsureCustomer(ctx, pool, paymentClient, userID)
	if err != nil {
		return "", err
	}
	si, err := paymentClient.CreateSetupIntent(ctx, customerID, "card")
	if err != nil {
		return "", err
	}
	return si.ClientSecret, nil
}

// CreateBankSetupIntentSecret is CreateSetupIntentSecret's bank-account
// counterpart — backs "Link a bank account" in Account Settings and
// checkout's inline bank-linking flow. The buyer authenticates with their
// real bank through Stripe's Financial Connections, embedded directly in
// the Payment Element this client secret drives — we never see their bank
// login or account/routing numbers, only the resulting PaymentMethod id.
func CreateBankSetupIntentSecret(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID string) (string, error) {
	customerID, err := EnsureCustomer(ctx, pool, paymentClient, userID)
	if err != nil {
		return "", err
	}
	si, err := paymentClient.CreateSetupIntent(ctx, customerID, "us_bank_account")
	if err != nil {
		return "", err
	}
	return si.ClientSecret, nil
}

// verifyOwnership confirms paymentMethodID actually belongs to userID's
// own Stripe customer before SetDefault/Delete act on it — a forged or
// stale id from one account must never let it touch another account's
// saved card.
func verifyOwnership(ctx context.Context, paymentClient *payment.Client, customerID, paymentMethodID string) error {
	pm, err := paymentClient.RetrievePaymentMethod(ctx, paymentMethodID)
	if err != nil {
		return err
	}
	if pm.Customer == nil || pm.Customer.ID != customerID {
		return ErrNotFound
	}
	return nil
}

// SetDefault marks one of userID's own saved cards as their default —
// "Make default" in Account Settings, and which card checkout
// automatically uses from then on.
func SetDefault(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, paymentMethodID string) error {
	customerID, err := existingCustomerID(ctx, pool, userID)
	if err != nil {
		return err
	}
	if customerID == "" {
		return ErrNotFound
	}
	if err := verifyOwnership(ctx, paymentClient, customerID, paymentMethodID); err != nil {
		return err
	}
	return paymentClient.SetDefaultPaymentMethod(ctx, customerID, paymentMethodID)
}

// Delete removes one of userID's own saved cards entirely — "Remove" in
// Account Settings.
func Delete(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, paymentMethodID string) error {
	customerID, err := existingCustomerID(ctx, pool, userID)
	if err != nil {
		return err
	}
	if customerID == "" {
		return ErrNotFound
	}
	if err := verifyOwnership(ctx, paymentClient, customerID, paymentMethodID); err != nil {
		return err
	}
	return paymentClient.DetachPaymentMethod(ctx, paymentMethodID)
}
