package message

import (
	"context"
	"errors"
	"fmt"
	"math/rand"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AllowDevSimulateIncoming gates DevSimulateIncoming — set once at boot
// from platform.Config.Environment (cmd/api/main.go, alongside
// seller.AllowDevTierAdjust/order.AllowDevAdvance), never flipped
// per-request. Off in production regardless of whether a client somehow
// reaches the route at all — belt-and-suspenders, same shape as every
// other dev-only affordance in this codebase.
var AllowDevSimulateIncoming = true

// ErrDevSimulateDisabled is returned by DevSimulateIncoming when
// AllowDevSimulateIncoming is false.
var ErrDevSimulateDisabled = errors.New("message: dev simulate-incoming is disabled outside development")

// ErrNoOtherUsers is returned when there's no other real user in the
// database to simulate a message from — only possible against a brand-new,
// essentially empty database.
var ErrNoOtherUsers = errors.New("message: no other user exists to send a dev test message from")

// devMessageBodies is a small pool of realistic buyer/seller one-liners,
// picked at random each call so mashing the dev panel's "Get a Message"
// button doesn't always produce the same bubble — same variety reasoning
// as DevQuickSwitch's own TEST_NOTIFICATIONS pool for CelebrationToast.
var devMessageBodies = []string{
	"Hey! Is this still available?",
	"Would you take $45 shipped for it?",
	"Thanks so much for the fast shipping!",
	"Can you send another photo of the back corner?",
	"Just checking in — any update on tracking?",
	"Is the card centered well? Hard to tell from the photos.",
}

// DevSimulateIncoming sends one real message from some other real user in
// the database to recipientID, through the exact same StartThreadWithMessage
// path a real "Message seller" click uses. Unlike CelebrationToast's TN
// button — which fabricates a client-side item because there's no real
// celebration data worth faking a round trip for — this creates a real
// thread and a real row, so the recipient's own MessageBubbleWatcher poll
// picks it up exactly the way a genuine incoming message would.
func DevSimulateIncoming(ctx context.Context, pool *pgxpool.Pool, recipientID string) error {
	if !AllowDevSimulateIncoming {
		return ErrDevSimulateDisabled
	}

	var senderID string
	err := pool.QueryRow(ctx, `
		select id from users where id != $1 order by random() limit 1
	`, recipientID).Scan(&senderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoOtherUsers
		}
		return fmt.Errorf("pick dev sender: %w", err)
	}

	body := devMessageBodies[rand.Intn(len(devMessageBodies))]
	_, err = StartThreadWithMessage(ctx, pool, senderID, recipientID, nil, body)
	return err
}
