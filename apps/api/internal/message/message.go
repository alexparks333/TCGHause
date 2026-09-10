package message

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/pkg/money"
)

var (
	ErrNotFound       = errors.New("conversation not found")
	ErrNotParticipant = errors.New("not a participant in this conversation")
	ErrSelfMessage    = errors.New("cannot message yourself")
	ErrEmptyBody      = errors.New("message cannot be empty")
)

const maxBodyLength = 4000

// Counterpart is the "who this conversation is with" half of a
// ThreadSummary/ThreadDetail — deliberately just id/username, the same
// shallow shape as everywhere else a user is shown to another user (never
// email, per internal/user's doc comment).
type Counterpart struct {
	ID       string  `json:"id"`
	Username *string `json:"username"`
}

// ThreadListing is the optional "About: <title>" context a thread carries
// from whichever listing it was started from — omitted entirely (nil) for
// a thread started from a seller's profile page rather than a listing.
type ThreadListing struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Game backs the frontend's gradient placeholder (ListingImage/CardArt)
	// when ImageURL is empty — a dev quick-list listing with no real photo,
	// most often — only ever populated by GetThreadDetail (the one place
	// this actually renders a thumbnail); left blank elsewhere.
	Game     string `json:"game,omitempty"`
	ImageURL string `json:"imageUrl,omitempty"`
}

// OfferSummary is the live state of the offer a kind="offer" Message
// points at — always re-read fresh from the offers table on every fetch
// (never frozen at message-creation time), so accepting/declining it from
// the listing page or Bids/Offers is reflected here the next time this
// thread is fetched, exactly as if it had been accepted/declined from this
// same message. BuyerID/SellerID (not just "mine"/"theirs") are included
// because a thread is per pair-of-users, not per listing — the same two
// people could in principle be buyer and seller of each other's listings
// across different offers in one conversation, so which side of THIS
// specific offer the viewer is on can't be inferred from who sent the
// message alone.
type OfferSummary struct {
	ID           string `json:"id"`
	ListingID    string `json:"listingId"`
	ListingTitle string `json:"listingTitle"`
	// ListingGame backs the frontend's gradient placeholder (ListingImage/
	// CardArt) when ListingImageURL is empty, same reasoning as
	// ThreadListing.Game.
	ListingGame     string `json:"listingGame"`
	ListingImageURL string `json:"listingImageUrl,omitempty"`
	BuyerID         string `json:"buyerId"`
	SellerID        string `json:"sellerId"`
	AmountCents     int64  `json:"amountCents"`
	Status          string `json:"status"`
}

// Message is one row in a thread, always rendered against the viewer's own
// id client-side to decide left/right alignment — there is no
// viewer-relative field here, same "just the facts" shape as Notification.
// Kind is "text" for an ordinary message or "offer" for one posted by
// internal/offer.Submit (CreateOfferMessage below) — Offer is only ever
// set alongside kind="offer". Body is always populated even for an offer
// message (a plain-text summary), so a client that doesn't render kind
// specially, or the thread list's last-message preview, still shows
// something sensible.
type Message struct {
	ID        string        `json:"id"`
	ThreadID  string        `json:"threadId"`
	SenderID  string        `json:"senderId"`
	Body      string        `json:"body"`
	Kind      string        `json:"kind"`
	Offer     *OfferSummary `json:"offer,omitempty"`
	CreatedAt string        `json:"createdAt"`
}

// ThreadSummary backs the inbox list — one row per conversation, with
// enough denormalized state (last message, unread) to render the whole
// list without an N+1 per thread.
type ThreadSummary struct {
	ID          string         `json:"id"`
	Counterpart Counterpart    `json:"counterpart"`
	Listing     *ThreadListing `json:"listing,omitempty"`
	// LastMessageKind is "offer" or "text" — re-read live from the actual
	// last message row (never the denormalized last_message_preview text
	// alone), so the inbox list can render a real "Sent/Received an Offer"
	// pill for an offer instead of just its plain-text fallback body.
	LastMessageKind   string `json:"lastMessageKind"`
	LastMessageBody   string `json:"lastMessageBody"`
	LastMessageAt     string `json:"lastMessageAt"`
	LastMessageIsMine bool   `json:"lastMessageIsMine"`
	Unread            bool   `json:"unread"`
}

// ThreadDetail is a single conversation's full message history plus the
// same header info ThreadSummary shows in the list — GetThreadDetail
// returns this so the thread view never needs a second round trip just to
// know who it's talking to.
type ThreadDetail struct {
	ID          string         `json:"id"`
	Counterpart Counterpart    `json:"counterpart"`
	Listing     *ThreadListing `json:"listing,omitempty"`
	Messages    []Message      `json:"messages"`
}

// normalizeParticipants returns (a, b) ordered so a < b — message_threads'
// check constraint requires this, and it's what makes "the thread between
// X and Y" resolve to one row regardless of who clicked first.
func normalizeParticipants(userA, userB string) (string, string) {
	if userA < userB {
		return userA, userB
	}
	return userB, userA
}

// startOrGetThread finds the existing thread between two users, or creates
// one — on conflict do nothing plus a re-select, so two concurrent
// "message this seller" clicks from the same pair of users can never
// create two threads (message_threads_participants_idx is what actually
// enforces this at the database level). listingID is only ever recorded
// on first creation — it's the conversation's original context, not
// something later messages update.
func startOrGetThread(ctx context.Context, tx pgx.Tx, userA, userB string, listingID *string) (string, error) {
	if userA == userB {
		return "", ErrSelfMessage
	}
	p1, p2 := normalizeParticipants(userA, userB)

	var id string
	err := tx.QueryRow(ctx, `
		insert into message_threads (participant_one, participant_two, listing_id)
		values ($1, $2, $3)
		on conflict (participant_one, participant_two) do nothing
		returning id
	`, p1, p2, listingID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("insert thread: %w", err)
	}

	// Conflict path: the thread already existed, so the insert above
	// returned no row — fetch its id instead.
	if err := tx.QueryRow(ctx, `
		select id from message_threads where participant_one = $1 and participant_two = $2
	`, p1, p2).Scan(&id); err != nil {
		return "", fmt.Errorf("select existing thread: %w", err)
	}
	return id, nil
}

// StartThreadWithMessage is the one-shot "message this seller" flow: find
// or create the thread, then send the first message in it, atomically —
// callers never see a thread that exists with zero messages in it, or a
// message whose thread creation silently failed.
func StartThreadWithMessage(ctx context.Context, pool *pgxpool.Pool, senderID, recipientID string, listingID *string, body string) (*ThreadDetail, error) {
	if senderID == recipientID {
		return nil, ErrSelfMessage
	}
	if err := validateBody(body); err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	threadID, err := startOrGetThread(ctx, tx, senderID, recipientID, listingID)
	if err != nil {
		return nil, err
	}
	if err := insertMessage(ctx, tx, threadID, senderID, body); err != nil {
		return nil, err
	}
	if err := markReadTx(ctx, tx, threadID, senderID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return GetThreadDetail(ctx, pool, senderID, threadID)
}

// CreateOfferMessage posts offerID as a native "offer" message into the
// real conversation between its buyer and seller — found or created
// exactly like StartThreadWithMessage, called by internal/offer.Submit
// right after an offer is recorded so it shows up in the thread between
// the two people it actually concerns, not just on the listing page and
// Bids/Offers. listingID is only recorded on the thread if this is its
// first-ever message (startOrGetThread's own rule), same as a regular
// "Message Seller" click. The body is a plain-text fallback (used by
// clients that don't render kind="offer" specially, and by the thread
// list's last-message preview) — the actual amount/status a viewer sees is
// always re-derived live via OfferSummary, never frozen here.
func CreateOfferMessage(ctx context.Context, pool *pgxpool.Pool, buyerID, sellerID, offerID, listingID string, amountCents int64, listingTitle string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	threadID, err := startOrGetThread(ctx, tx, buyerID, sellerID, &listingID)
	if err != nil {
		return err
	}

	body := fmt.Sprintf("Sent an offer: %s on %s", money.Cents(amountCents), listingTitle)
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		insert into messages (thread_id, sender_id, body, kind, offer_id)
		values ($1, $2, $3, 'offer', $4)
		returning created_at
	`, threadID, buyerID, body, offerID).Scan(&createdAt); err != nil {
		return fmt.Errorf("insert offer message: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		update message_threads
		set last_message_at = $2, last_message_preview = $3, last_message_sender_id = $4
		where id = $1
	`, threadID, createdAt, previewOf(body), buyerID); err != nil {
		return fmt.Errorf("touch thread: %w", err)
	}

	// Sending an offer is, from the buyer's own point of view, always
	// "read" — same reasoning as insertMessageReturning's own call below.
	if err := markReadTx(ctx, tx, threadID, buyerID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ReviseOfferMessage is what internal/offer.Submit calls instead of
// CreateOfferMessage when a buyer revises their own still-pending offer —
// the offer row itself is updated in place (same id), and this moves its
// one existing message to match: re-touches its body (the plain-text
// fallback) and bumps its created_at to now, so it re-sorts to the bottom
// of the thread as the freshest activity, exactly where a real new message
// would land — and bumps the thread's own last-message fields the same
// way, so the seller's inbox surfaces it as unread/most-recent too.
// Deliberately does NOT insert a second message row or a second
// offer_received notification: that's the flooding this whole "revise in
// place" design exists to avoid — one buyer reconsidering their number
// several times should still only ever show up as one live ask, not a
// growing stack of them.
func ReviseOfferMessage(ctx context.Context, pool *pgxpool.Pool, offerID, buyerID string, amountCents int64, listingTitle string) error {
	body := fmt.Sprintf("Sent an offer: %s on %s", money.Cents(amountCents), listingTitle)

	var threadID string
	if err := pool.QueryRow(ctx, `
		update messages set body = $1, created_at = now()
		where offer_id = $2
		returning thread_id
	`, body, offerID).Scan(&threadID); err != nil {
		return fmt.Errorf("touch offer message: %w", err)
	}

	if _, err := pool.Exec(ctx, `
		update message_threads
		set last_message_at = now(), last_message_preview = $2, last_message_sender_id = $3
		where id = $1
	`, threadID, previewOf(body), buyerID); err != nil {
		return fmt.Errorf("touch thread: %w", err)
	}

	return nil
}

// SendMessage appends to an existing thread — verifies the caller is
// actually one of its two participants (never trust the id in the URL
// alone), same defense-in-depth shape as watchlist/order's ownership
// checks throughout this codebase.
func SendMessage(ctx context.Context, pool *pgxpool.Pool, senderID, threadID, body string) (*Message, error) {
	if err := validateBody(body); err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := requireParticipant(ctx, tx, threadID, senderID); err != nil {
		return nil, err
	}
	msg, err := insertMessageReturning(ctx, tx, threadID, senderID, body)
	if err != nil {
		return nil, err
	}
	// Sending a message is, from the sender's own point of view, always
	// "read" — otherwise the thread you just replied in would immediately
	// show back up as unread for you.
	if err := markReadTx(ctx, tx, threadID, senderID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return msg, nil
}

func validateBody(body string) error {
	if len(body) == 0 || len(body) > maxBodyLength {
		return ErrEmptyBody
	}
	return nil
}

func requireParticipant(ctx context.Context, tx pgx.Tx, threadID, userID string) error {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1 from message_threads
			where id = $1 and (participant_one = $2 or participant_two = $2)
		)
	`, threadID, userID).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check participant: %w", err)
	}
	if !exists {
		var threadExists bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from message_threads where id = $1)`, threadID).Scan(&threadExists); err != nil {
			return fmt.Errorf("check thread exists: %w", err)
		}
		if !threadExists {
			return ErrNotFound
		}
		return ErrNotParticipant
	}
	return nil
}

func insertMessage(ctx context.Context, tx pgx.Tx, threadID, senderID, body string) error {
	_, err := insertMessageReturning(ctx, tx, threadID, senderID, body)
	return err
}

func insertMessageReturning(ctx context.Context, tx pgx.Tx, threadID, senderID, body string) (*Message, error) {
	var m Message
	var createdAt time.Time
	err := tx.QueryRow(ctx, `
		insert into messages (thread_id, sender_id, body)
		values ($1, $2, $3)
		returning id, thread_id, sender_id, body, created_at
	`, threadID, senderID, body).Scan(&m.ID, &m.ThreadID, &m.SenderID, &m.Body, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("insert message: %w", err)
	}
	m.Kind = "text"
	m.CreatedAt = createdAt.Format(time.RFC3339)

	if _, err := tx.Exec(ctx, `
		update message_threads
		set last_message_at = $2, last_message_preview = $3, last_message_sender_id = $4
		where id = $1
	`, threadID, createdAt, previewOf(body), senderID); err != nil {
		return nil, fmt.Errorf("touch thread: %w", err)
	}
	return &m, nil
}

const previewMaxLen = 140

// previewOf trims a message body down to what the inbox list actually
// needs to render — storing the full body twice (once in messages, once
// in the thread's denormalized preview) is fine since this is capped and
// only ever overwritten, never appended to.
func previewOf(body string) string {
	r := []rune(body)
	if len(r) <= previewMaxLen {
		return body
	}
	return string(r[:previewMaxLen]) + "…"
}

func markReadTx(ctx context.Context, tx pgx.Tx, threadID, userID string) error {
	_, err := tx.Exec(ctx, `
		insert into message_thread_reads (thread_id, user_id, last_read_at)
		values ($1, $2, now())
		on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at
	`, threadID, userID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}

// MarkThreadRead is the standalone entry point GetThreadDetail uses —
// opening a conversation is what reading it means here, there's no
// separate "mark read" UI action the way the notification bell has one
// (see package doc comment).
func MarkThreadRead(ctx context.Context, pool *pgxpool.Pool, userID, threadID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := requireParticipant(ctx, tx, threadID, userID); err != nil {
		return err
	}
	if err := markReadTx(ctx, tx, threadID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetThreadDetail returns one conversation's full history, and — since
// there's no separate "mark read" click in this UI — marks it read for
// the caller as a side effect of fetching it, the same instant a Gmail or
// iMessage conversation is considered read the moment you open it.
func GetThreadDetail(ctx context.Context, pool *pgxpool.Pool, userID, threadID string) (*ThreadDetail, error) {
	var counterpartID string
	var counterpartUsername *string
	var listingID *string
	var listingTitle *string
	var listingGame *string
	var listingImageURLs []string
	err := pool.QueryRow(ctx, `
		select
			case when t.participant_one = $2 then t.participant_two else t.participant_one end,
			cu.username,
			l.id, l.title, l.game, l.image_urls
		from message_threads t
		join users cu on cu.id = case when t.participant_one = $2 then t.participant_two else t.participant_one end
		left join listings l on l.id = t.listing_id
		where t.id = $1 and (t.participant_one = $2 or t.participant_two = $2)
	`, threadID, userID).Scan(&counterpartID, &counterpartUsername, &listingID, &listingTitle, &listingGame, &listingImageURLs)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var exists bool
			if checkErr := pool.QueryRow(ctx, `select exists (select 1 from message_threads where id = $1)`, threadID).Scan(&exists); checkErr == nil && !exists {
				return nil, ErrNotFound
			}
			return nil, ErrNotParticipant
		}
		return nil, fmt.Errorf("query thread: %w", err)
	}

	rows, err := pool.Query(ctx, `
		select m.id, m.thread_id, m.sender_id, m.body, m.kind, m.created_at,
			o.id, o.listing_id, ol.title, ol.game, ol.image_urls, o.buyer_id, o.seller_id, o.amount_cents, o.status
		from messages m
		left join offers o on o.id = m.offer_id
		left join listings ol on ol.id = o.listing_id
		where m.thread_id = $1
		order by m.created_at asc
	`, threadID)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	messages := []Message{}
	for rows.Next() {
		var m Message
		var createdAt time.Time
		var offerID, offerListingID, offerListingTitle, offerListingGame, offerBuyerID, offerSellerID, offerStatus *string
		var offerAmountCents *int64
		var offerListingImageURLs []string
		if err := rows.Scan(
			&m.ID, &m.ThreadID, &m.SenderID, &m.Body, &m.Kind, &createdAt,
			&offerID, &offerListingID, &offerListingTitle, &offerListingGame, &offerListingImageURLs, &offerBuyerID, &offerSellerID, &offerAmountCents, &offerStatus,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		m.CreatedAt = createdAt.Format(time.RFC3339)
		if offerID != nil {
			summary := OfferSummary{
				ID:           *offerID,
				ListingID:    *offerListingID,
				ListingTitle: *offerListingTitle,
				ListingGame:  *offerListingGame,
				BuyerID:      *offerBuyerID,
				SellerID:     *offerSellerID,
				AmountCents:  *offerAmountCents,
				Status:       *offerStatus,
			}
			if len(offerListingImageURLs) > 0 {
				summary.ListingImageURL = offerListingImageURLs[0]
			}
			m.Offer = &summary
		}
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	detail := &ThreadDetail{
		ID:          threadID,
		Counterpart: Counterpart{ID: counterpartID, Username: counterpartUsername},
		Messages:    messages,
	}
	if listingID != nil {
		tl := ThreadListing{ID: *listingID, Title: *listingTitle, Game: *listingGame}
		if len(listingImageURLs) > 0 {
			tl.ImageURL = listingImageURLs[0]
		}
		detail.Listing = &tl
	}

	if err := MarkThreadRead(ctx, pool, userID, threadID); err != nil {
		return nil, fmt.Errorf("mark read: %w", err)
	}

	return detail, nil
}

// ListThreadsForUser returns every conversation the caller is in, newest
// activity first, plus how many of them are unread — mirrors
// notification.ListForUser's "list + count in one round trip" shape,
// since the inbox needs both (the list itself, and the badge count) at
// once. Unread here means conversations, not individual messages — the
// same "3 unread" a Gmail-style badge means, not a raw message tally.
func ListThreadsForUser(ctx context.Context, pool *pgxpool.Pool, userID string) ([]ThreadSummary, int, error) {
	rows, err := pool.Query(ctx, `
		select
			t.id,
			case when t.participant_one = $1 then t.participant_two else t.participant_one end as counterpart_id,
			cu.username,
			t.listing_id, l.title, l.image_urls,
			t.last_message_preview, t.last_message_at, t.last_message_sender_id,
			coalesce(r.last_read_at, 'epoch'::timestamptz) as last_read_at,
			(select m.kind from messages m where m.thread_id = t.id order by m.created_at desc limit 1) as last_message_kind
		from message_threads t
		join users cu on cu.id = case when t.participant_one = $1 then t.participant_two else t.participant_one end
		left join listings l on l.id = t.listing_id
		left join message_thread_reads r on r.thread_id = t.id and r.user_id = $1
		where t.participant_one = $1 or t.participant_two = $1
		order by t.last_message_at desc
	`, userID)
	if err != nil {
		return nil, 0, fmt.Errorf("query threads: %w", err)
	}
	defer rows.Close()

	out := []ThreadSummary{}
	unreadCount := 0
	for rows.Next() {
		var s ThreadSummary
		var counterpartUsername *string
		var listingID, listingTitle *string
		var listingImageURLs []string
		var lastMessagePreview *string
		var lastMessageAt time.Time
		var lastMessageSenderID *string
		var lastReadAt time.Time
		var lastMessageKind *string
		if err := rows.Scan(
			&s.ID, &s.Counterpart.ID, &counterpartUsername,
			&listingID, &listingTitle, &listingImageURLs,
			&lastMessagePreview, &lastMessageAt, &lastMessageSenderID,
			&lastReadAt, &lastMessageKind,
		); err != nil {
			return nil, 0, fmt.Errorf("scan thread: %w", err)
		}
		s.Counterpart.Username = counterpartUsername
		if lastMessagePreview != nil {
			s.LastMessageBody = *lastMessagePreview
		}
		if lastMessageKind != nil {
			s.LastMessageKind = *lastMessageKind
		} else {
			s.LastMessageKind = "text"
		}
		s.LastMessageAt = lastMessageAt.Format(time.RFC3339)
		if lastMessageSenderID != nil {
			s.LastMessageIsMine = *lastMessageSenderID == userID
		}
		if listingID != nil {
			tl := ThreadListing{ID: *listingID, Title: *listingTitle}
			if len(listingImageURLs) > 0 {
				tl.ImageURL = listingImageURLs[0]
			}
			s.Listing = &tl
		}
		s.Unread = !s.LastMessageIsMine && lastMessageAt.After(lastReadAt)
		if s.Unread {
			unreadCount++
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return out, unreadCount, nil
}
