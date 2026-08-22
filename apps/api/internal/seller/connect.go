// Package seller owns a seller's standing on the platform: Stripe Connect
// account state (this file) and, once built (design doc v2 §3, CLAUDE.md
// §5.4), the trust-tier engine. Both live in one package because they're
// both facets of "seller standing" against the same users row — a Connect
// account id is the seller's merchant identity, tier is their trust
// standing, and pkg/fees calls into this package's tier->percentage
// mapping, never the reverse.
package seller

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v82"

	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/user"
)

// ConnectAccountStatus is the frontend-facing shape of a seller's Connect
// onboarding state — enough to decide whether to show "set up payouts",
// "finish setup", or "you're all set".
type ConnectAccountStatus struct {
	HasAccount       bool `json:"hasAccount"`
	ChargesEnabled   bool `json:"chargesEnabled"`
	PayoutsEnabled   bool `json:"payoutsEnabled"`
	DetailsSubmitted bool `json:"detailsSubmitted"`
}

// EnsureConnectAccount returns userID's Stripe Connect account id, creating
// one (with a manual payout schedule, design doc v2 §6.1) the first time
// this is called for them — every subsequent call is just a DB read, same
// lazy-create pattern as internal/paymentmethod.EnsureCustomer. webOrigin
// builds the seller's own AuctionHous profile page as their Connect
// business_profile.url, if they've claimed a username — see
// payment.CreateExpressAccount's doc comment for why that (plus a fixed
// product description) matters: it's what keeps Stripe's hosted onboarding
// from stopping to ask an individual seller for a business website they
// don't have.
func EnsureConnectAccount(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, webOrigin string) (string, error) {
	if existing, err := StripeAccountID(ctx, pool, userID); err != nil {
		return "", err
	} else if existing != "" {
		return existing, nil
	}

	u, err := user.Get(ctx, pool, userID)
	if err != nil {
		return "", fmt.Errorf("get user: %w", err)
	}
	// Stripe rejects business_profile.url outright ("Not a valid URL") if
	// it isn't a real, publicly-routable address — localhost fails this
	// unconditionally. In local dev, webOrigin is http://localhost:4000,
	// so this omits the URL entirely there rather than making account
	// creation itself fail; ProductDescription alone (set unconditionally
	// in CreateExpressAccount) is what actually satisfies Stripe's
	// requirement to skip asking for a website.
	var profileURL string
	if u.Username != nil && !isLocalOrigin(webOrigin) {
		profileURL = webOrigin + "/seller/" + *u.Username
	}
	acct, err := paymentClient.CreateExpressAccount(ctx, u.Email, profileURL)
	if err != nil {
		return "", err
	}
	if _, err := pool.Exec(ctx, `update users set stripe_account_id = $1 where id = $2`, acct.ID, userID); err != nil {
		return "", fmt.Errorf("store stripe account id: %w", err)
	}
	return acct.ID, nil
}

// isLocalOrigin reports whether webOrigin points at a local dev server —
// Stripe validates business_profile.url as a real, resolvable address and
// rejects localhost/127.0.0.1 unconditionally, regardless of port.
func isLocalOrigin(webOrigin string) bool {
	return strings.Contains(webOrigin, "localhost") || strings.Contains(webOrigin, "127.0.0.1")
}

// CreateOnboardingLink ensures userID has a Connect account, then returns a
// fresh Stripe-hosted onboarding URL for it.
func CreateOnboardingLink(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, userID, webOrigin, returnURL, refreshURL string) (string, error) {
	accountID, err := EnsureConnectAccount(ctx, pool, paymentClient, userID, webOrigin)
	if err != nil {
		return "", err
	}
	link, err := paymentClient.CreateAccountLink(ctx, accountID, returnURL, refreshURL)
	if err != nil {
		return "", err
	}
	return link.URL, nil
}

// RequirePayoutsEnabled returns sellerID's Connect account id, only if
// Stripe has actually enabled payouts on it — the single check checkout
// needs before authorizing a purchase (docs/Legal_MoneyTransitter.md /
// separate charges and transfers: the buyer's card is charged on the
// PLATFORM account regardless of this account's state, but there's no
// point authorizing a sale whose eventual release-time Transfer would just
// fail). Deliberately checks payouts, not charges enabled — under separate
// charges and transfers a seller's connected account only ever RECEIVES a
// Transfer and pays it out, it never accepts a charge itself, so
// connect_charges_enabled (which requires the card_payments capability,
// full individual KYC, and a statement descriptor this app no longer
// requests, see payment.CreateExpressAccount) isn't the right gate anymore
// and will simply never go true for accounts created after this change.
// Returns "" (not an error) if the seller has no account yet or hasn't
// finished onboarding — callers turn that into their own "not ready to
// sell" error.
func RequirePayoutsEnabled(ctx context.Context, pool *pgxpool.Pool, sellerID string) (string, error) {
	var accountID *string
	var payoutsEnabled bool
	err := pool.QueryRow(ctx, `
		select stripe_account_id, connect_payouts_enabled from users where id = $1
	`, sellerID).Scan(&accountID, &payoutsEnabled)
	if err != nil {
		return "", fmt.Errorf("read seller connect status: %w", err)
	}
	if accountID == nil || !payoutsEnabled {
		return "", nil
	}
	return *accountID, nil
}

// GetConnectAccountStatus reads userID's current onboarding state straight
// from our own DB — kept in sync by the account.updated webhook
// (internal/webhook), never queried live from Stripe on every page load.
func GetConnectAccountStatus(ctx context.Context, pool *pgxpool.Pool, userID string) (ConnectAccountStatus, error) {
	var status ConnectAccountStatus
	var accountID *string
	err := pool.QueryRow(ctx, `
		select stripe_account_id, connect_charges_enabled, connect_payouts_enabled, connect_details_submitted
		from users where id = $1`, userID,
	).Scan(&accountID, &status.ChargesEnabled, &status.PayoutsEnabled, &status.DetailsSubmitted)
	if err != nil {
		return ConnectAccountStatus{}, fmt.Errorf("read connect account status: %w", err)
	}
	status.HasAccount = accountID != nil
	return status, nil
}

// SyncConnectAccountFromWebhook updates our cached view of a Connect
// account's onboarding state from a Stripe account.updated event — the
// only source of truth for "did onboarding actually finish," never a
// client-side redirect-back claim (design doc v2 §5.2).
func SyncConnectAccountFromWebhook(ctx context.Context, pool *pgxpool.Pool, acct *stripe.Account) error {
	tag, err := pool.Exec(ctx, `
		update users set
			connect_charges_enabled = $1,
			connect_payouts_enabled = $2,
			connect_details_submitted = $3,
			connect_onboarded_at = case when $3 and connect_onboarded_at is null then now() else connect_onboarded_at end
		where stripe_account_id = $4`,
		acct.ChargesEnabled, acct.PayoutsEnabled, acct.DetailsSubmitted, acct.ID,
	)
	if err != nil {
		return fmt.Errorf("sync connect account status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// No user row has this account id — most likely a webhook for an
		// account this platform didn't create (shouldn't happen in
		// practice, since we only register our own webhook endpoint), or
		// a race where the DB write in EnsureConnectAccount hasn't
		// committed yet. Not an error worth failing the webhook over;
		// Stripe will redeliver on a 5xx, and simply doing nothing here
		// is safe either way.
		return nil
	}
	return nil
}
