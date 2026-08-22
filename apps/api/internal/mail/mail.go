// Package mail sends real transactional email via Resend — used today for
// exactly one thing: internal/dispute alerting support@auctionhous.net when
// a claim lands in human_review (the cases that actually need a person,
// deliberately not every claim opened — see claim.go's Escalate). Nothing
// else in this repo sends real email yet.
package mail

import (
	"context"
	"fmt"

	"github.com/resend/resend-go/v2"
)

// Client is nil when RESEND_API_KEY isn't set — same graceful-degradation
// pattern as payment.Client/shipping.Client: callers check IsConfigured()
// and skip sending rather than failing to boot.
type Client struct {
	rs   *resend.Client
	from string
	to   string
}

// NewClient builds a mail client, or returns nil if apiKey is empty. from
// and to are the fixed sender/recipient for the one notification this
// package sends — not a general-purpose "send to anyone" API, so there's no
// per-call from/to to get wrong.
func NewClient(apiKey, from, to string) *Client {
	if apiKey == "" {
		return nil
	}
	return &Client{rs: resend.NewClient(apiKey), from: from, to: to}
}

func (c *Client) IsConfigured() bool {
	return c != nil
}

// Send fires one email from/to the fixed addresses this client was built
// with. Callers treat a failure as logged-not-fatal (see claim.go's
// Escalate) — a missed notification email is a recoverable, visible
// problem, not a reason to leave a claim stuck mid-transition.
func (c *Client) Send(ctx context.Context, subject, html string) error {
	_, err := c.rs.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    c.from,
		To:      []string{c.to},
		Subject: subject,
		Html:    html,
	})
	if err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}
