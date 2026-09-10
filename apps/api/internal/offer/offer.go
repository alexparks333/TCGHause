// Package offer implements real offer/negotiation state on top of a
// listing's Buy It Now price (CLAUDE.md's "allow offers, with a real
// minimum" ask) — a buyer proposes a flat amount below the listing's BIN
// price, gated by listings.allow_offers/min_offer_cents (migration 0049),
// and the listing's own seller accepts or declines it.
//
// Accepting an offer closes the listing to that buyer immediately, at the
// offered price — "it's as if the buyer has won" (CLAUDE.md), exactly like
// a Buy It Now purchase or a won auction: no more bidding/time left, no
// longer purchasable by anyone else. See Accept's own doc comment for the
// close mechanics (auctions.go 0052/sold_price_cents) and
// internal/auction.CreatePendingOrderForWin for how the buyer gets a real,
// unpaid order to pay off via the existing checkout flow, same as a regular
// auction win.
package offer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/auction"
	"auctionhous-tcg/api/internal/message"
	"auctionhous-tcg/api/internal/notification"
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusAccepted  Status = "accepted"
	StatusDeclined  Status = "declined"
	StatusWithdrawn Status = "withdrawn"
	StatusExpired   Status = "expired"
)

var (
	ErrNotFound           = errors.New("offer not found")
	ErrNotParticipant     = errors.New("not a participant in this offer")
	ErrOffersNotAllowed   = errors.New("this listing does not accept offers")
	ErrSelfOffer          = errors.New("sellers cannot make an offer on their own listing")
	ErrInvalidAmount      = errors.New("offer amount must be positive and less than the Buy It Now price")
	ErrBelowMinimum       = errors.New("offer amount is below the seller's minimum")
	ErrListingNotActive   = errors.New("this listing is no longer active")
	ErrAlreadyPending     = errors.New("you already have a pending offer on this listing")
	ErrNotPending         = errors.New("this offer has already been responded to")
	ErrListingUnavailable = errors.New("this listing is no longer available to sell")
)

// Offer is denormalized with the listing's title/photo and both
// participants' usernames — same "no N+1 per row" reasoning as
// message.ThreadSummary — so a list of offers never needs a second round
// trip per row to render.
type Offer struct {
	ID              string  `json:"id"`
	ListingID       string  `json:"listingId"`
	ListingTitle    string  `json:"listingTitle"`
	ListingImageURL string  `json:"listingImageUrl,omitempty"`
	BuyerID         string  `json:"buyerId"`
	BuyerUsername   *string `json:"buyerUsername"`
	SellerID        string  `json:"sellerId"`
	SellerUsername  *string `json:"sellerUsername"`
	AmountCents     int64   `json:"amountCents"`
	Status          Status  `json:"status"`
	CreatedAt       string  `json:"createdAt"`
	RespondedAt     *string `json:"respondedAt,omitempty"`
}

const selectColumns = `
	o.id, o.listing_id, l.title, l.image_urls,
	o.buyer_id, bu.username, o.seller_id, su.username,
	o.amount_cents, o.status, o.created_at, o.responded_at
`

const fromClause = `
	from offers o
	join listings l on l.id = o.listing_id
	join users bu on bu.id = o.buyer_id
	join users su on su.id = o.seller_id
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanOffer(row rowScanner) (Offer, error) {
	var o Offer
	var imageURLs []string
	var status string
	var createdAt time.Time
	var respondedAt *time.Time
	err := row.Scan(
		&o.ID, &o.ListingID, &o.ListingTitle, &imageURLs,
		&o.BuyerID, &o.BuyerUsername, &o.SellerID, &o.SellerUsername,
		&o.AmountCents, &status, &createdAt, &respondedAt,
	)
	if err != nil {
		return Offer{}, err
	}
	if len(imageURLs) > 0 {
		o.ListingImageURL = imageURLs[0]
	}
	o.Status = Status(status)
	o.CreatedAt = createdAt.Format(time.RFC3339)
	if respondedAt != nil {
		s := respondedAt.Format(time.RFC3339)
		o.RespondedAt = &s
	}
	return o, nil
}

// Submit validates and records one offer from buyerID on listingID — every
// gate a real offer has to clear:
//   - the listing exists and is still active
//   - buyerID isn't the listing's own seller
//   - the listing actually has allow_offers set
//   - amountCents is positive and strictly less than the listing's real
//     Buy It Now price (fixed listings: their own price_cents; auctions:
//     their optional buy_it_now_price_cents — nil there means no BIN price
//     exists at all, so offers can never be enabled to begin with)
//   - amountCents meets min_offer_cents, when the seller set one
//
// If buyerID already has a live PENDING offer on this listing, this
// doesn't create a second row or reject the call — it revises that same
// offer's amount in place instead (offers_one_pending_per_buyer_listing_idx
// is what makes "the buyer's one live offer" well-defined at the database
// level). That's a deliberate product decision: a buyer should be able to
// freely reconsider their number before the seller has responded, but
// letting each reconsideration post as its own new offer would flood the
// seller with a growing stack of pending offers/notifications/chat bubbles
// for what's really one ongoing ask. Once an offer is actually resolved
// (declined — accepted closes the listing, so a new one is moot), this no
// longer applies: the next Submit inserts a genuinely new, separate offer,
// and the declined one stays put as real history (message.ReviseOfferMessage
// is never involved past that point).
func Submit(ctx context.Context, pool *pgxpool.Pool, buyerID, listingID string, amountCents int64) (*Offer, error) {
	var (
		sellerID      string
		listingTitle  string
		status        string
		format        string
		allowOffers   bool
		minOfferCents *int64
		priceCents    *int64
		buyItNowCents *int64
	)
	err := pool.QueryRow(ctx, `
		select l.seller_id, l.title, l.status, l.format, l.allow_offers, l.min_offer_cents, l.price_cents, a.buy_it_now_price_cents
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.id = $1
	`, listingID).Scan(&sellerID, &listingTitle, &status, &format, &allowOffers, &minOfferCents, &priceCents, &buyItNowCents)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read listing: %w", err)
	}

	if buyerID == sellerID {
		return nil, ErrSelfOffer
	}
	if !allowOffers {
		return nil, ErrOffersNotAllowed
	}
	if status != "active" {
		return nil, ErrListingNotActive
	}

	binCents := priceCents
	if format == "auction" {
		binCents = buyItNowCents
	}
	// Not expected to be reachable — Create/Update never let allow_offers
	// be true without a real BIN price alongside it — but a missing BIN
	// price is treated the same as offers-not-allowed rather than trusted
	// blindly, same defense-in-depth posture as everywhere else in this
	// codebase that re-checks an invariant instead of assuming it holds.
	if binCents == nil {
		return nil, ErrOffersNotAllowed
	}
	if amountCents <= 0 || amountCents >= *binCents {
		return nil, ErrInvalidAmount
	}
	if minOfferCents != nil && amountCents < *minOfferCents {
		return nil, ErrBelowMinimum
	}

	var existingPendingID string
	err = pool.QueryRow(ctx, `
		select id from offers where listing_id = $1 and buyer_id = $2 and status = 'pending'
	`, listingID, buyerID).Scan(&existingPendingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("check existing offer: %w", err)
	}
	if existingPendingID != "" {
		if _, err := pool.Exec(ctx, `
			update offers set amount_cents = $1, created_at = now() where id = $2
		`, amountCents, existingPendingID); err != nil {
			return nil, fmt.Errorf("revise offer: %w", err)
		}
		if err := message.ReviseOfferMessage(ctx, pool, existingPendingID, buyerID, amountCents, listingTitle); err != nil {
			return nil, fmt.Errorf("revise offer message: %w", err)
		}
		return Get(ctx, pool, existingPendingID)
	}

	var id string
	err = pool.QueryRow(ctx, `
		insert into offers (listing_id, buyer_id, seller_id, amount_cents)
		values ($1, $2, $3, $4)
		returning id
	`, listingID, buyerID, sellerID, amountCents).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// A genuine race against another concurrent Submit from the
			// same buyer (both passed the existingPendingID check above
			// before either committed) — rare enough that surfacing it as
			// a plain error, rather than retrying as a revision, is fine.
			return nil, ErrAlreadyPending
		}
		return nil, fmt.Errorf("insert offer: %w", err)
	}

	if err := notification.CreateForOffer(ctx, pool, sellerID, notification.KindOfferReceived, listingID, id); err != nil {
		return nil, fmt.Errorf("notify offer received: %w", err)
	}

	// Posts the offer natively into the real conversation between this
	// buyer and seller too (CLAUDE.md: offers should be "fully fluid"
	// across the listing page, Bids/Offers, and Messages) — found-or-
	// created exactly like a regular "Message Seller" click, so it lands
	// in whatever thread these two already share rather than a new one.
	if err := message.CreateOfferMessage(ctx, pool, buyerID, sellerID, id, listingID, amountCents, listingTitle); err != nil {
		return nil, fmt.Errorf("post offer message: %w", err)
	}

	return Get(ctx, pool, id)
}

// Accept marks offerID accepted — sellerID must be the offer's own seller,
// and the offer must still be pending (a second accept/decline on an
// already-resolved offer is rejected, not silently re-applied) — and, in
// the same transaction, closes the listing to the buyer at the offered
// price: an auction is closed exactly like a Buy It Now purchase (outcome
// 'sold', closed_at, current_price_cents/high_bidder_id set to the offer's
// buyer/amount — CLAUDE.md §6.1's "only current price and high bidder are
// public" already covers this, nothing new to expose), and a fixed-format
// listing is closed the same way BuyNowFixed does (status 'ended', buyer_id
// set) plus sold_price_cents recording the negotiated amount, since a fixed
// listing's own price_cents must stay intact as "what it was asking," not
// "what it sold for" (checkout.go/buynow.go prefer sold_price_cents over
// price_cents once set). Both close paths reuse the exact same closed_at-
// is-null / buyer_id-is-null compare-and-swap guard as BuyNow/BuyNowFixed,
// so accepting an offer can never race against — and "win" over — a
// concurrent Buy It Now click on the same listing; whichever commits first
// keeps it, the other fails with ErrListingUnavailable.
//
// Every OTHER still-pending offer on this listing is auto-declined in the
// same transaction — the listing is sold, so leaving them pending would
// show a live Accept/Decline pair for an item that's already gone.
func Accept(ctx context.Context, pool *pgxpool.Pool, sellerID, offerID string) (*Offer, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		listingID              string
		buyerID                string
		actualSellerID         string
		status                 string
		amountCents            int64
		format                 string
		shippingPreset         string
		estimatedShippingCents *int64
		requestSignature       bool
	)
	err = tx.QueryRow(ctx, `
		select o.listing_id, o.buyer_id, o.seller_id, o.status, o.amount_cents,
			l.format, l.shipping_preset, l.estimated_shipping_cents, l.request_signature
		from offers o
		join listings l on l.id = o.listing_id
		where o.id = $1
		for update of o
	`, offerID).Scan(&listingID, &buyerID, &actualSellerID, &status, &amountCents,
		&format, &shippingPreset, &estimatedShippingCents, &requestSignature)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read offer: %w", err)
	}
	if actualSellerID != sellerID {
		return nil, ErrNotParticipant
	}
	if status != string(StatusPending) {
		return nil, ErrNotPending
	}

	if format == "fixed" {
		tag, err := tx.Exec(ctx, `
			update listings
			set status = 'ended', buyer_id = $1, sold_at = now(), sold_price_cents = $2
			where id = $3 and buyer_id is null and status <> 'ended'
		`, buyerID, amountCents, listingID)
		if err != nil {
			return nil, fmt.Errorf("close fixed listing: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, ErrListingUnavailable
		}
	} else {
		tag, err := tx.Exec(ctx, `
			update auctions
			set outcome = 'sold', closed_at = now(), current_price_cents = $1,
				high_bidder_id = $2, version = version + 1
			where listing_id = $3 and closed_at is null
		`, amountCents, buyerID, listingID)
		if err != nil {
			return nil, fmt.Errorf("close auction: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, ErrListingUnavailable
		}
		if _, err := tx.Exec(ctx, `update listings set status = 'ended' where id = $1`, listingID); err != nil {
			return nil, fmt.Errorf("update listing: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		update offers set status = $1, responded_at = now() where id = $2
	`, string(StatusAccepted), offerID); err != nil {
		return nil, fmt.Errorf("update offer: %w", err)
	}
	if err := notification.CreateForOffer(ctx, tx, buyerID, notification.KindOfferAccepted, listingID, offerID); err != nil {
		return nil, fmt.Errorf("notify offer accepted: %w", err)
	}

	rows, err := tx.Query(ctx, `
		update offers set status = 'declined', responded_at = now()
		where listing_id = $1 and id <> $2 and status = 'pending'
		returning id, buyer_id
	`, listingID, offerID)
	if err != nil {
		return nil, fmt.Errorf("decline other offers: %w", err)
	}
	type otherOffer struct {
		id      string
		buyerID string
	}
	var others []otherOffer
	for rows.Next() {
		var o otherOffer
		if err := rows.Scan(&o.id, &o.buyerID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan declined offer: %w", err)
		}
		others = append(others, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read declined offers: %w", err)
	}
	for _, o := range others {
		if err := notification.CreateForOffer(ctx, tx, o.buyerID, notification.KindOfferDeclined, listingID, o.id); err != nil {
			return nil, fmt.Errorf("notify other offer declined: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Best-effort, layered on top of the already-committed close/accept
	// decision above — same "a failure here must never look like the
	// purchase itself failed" reasoning as auction.createOrderRecord's own
	// doc comment. Gives the buyer a real, unpaid order row immediately
	// (Buy History / order status page / the listing's own "Pay now" link
	// all read this), exactly like winning via regular bidding does.
	auction.CreatePendingOrderForWin(ctx, pool, listingID, buyerID, sellerID, amountCents, shippingPreset, estimatedShippingCents, requestSignature)

	return Get(ctx, pool, offerID)
}

// Decline mirrors Accept for the reject path.
func Decline(ctx context.Context, pool *pgxpool.Pool, sellerID, offerID string) (*Offer, error) {
	return respond(ctx, pool, sellerID, offerID, StatusDeclined, notification.KindOfferDeclined)
}

func respond(ctx context.Context, pool *pgxpool.Pool, sellerID, offerID string, newStatus Status, notifyKind notification.Kind) (*Offer, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		listingID      string
		buyerID        string
		actualSellerID string
		status         string
	)
	err = tx.QueryRow(ctx, `
		select listing_id, buyer_id, seller_id, status from offers where id = $1 for update
	`, offerID).Scan(&listingID, &buyerID, &actualSellerID, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read offer: %w", err)
	}
	if actualSellerID != sellerID {
		return nil, ErrNotParticipant
	}
	if status != string(StatusPending) {
		return nil, ErrNotPending
	}

	if _, err := tx.Exec(ctx, `
		update offers set status = $1, responded_at = now() where id = $2
	`, string(newStatus), offerID); err != nil {
		return nil, fmt.Errorf("update offer: %w", err)
	}

	if err := notification.CreateForOffer(ctx, tx, buyerID, notifyKind, listingID, offerID); err != nil {
		return nil, fmt.Errorf("notify offer response: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return Get(ctx, pool, offerID)
}

func Get(ctx context.Context, pool *pgxpool.Pool, id string) (*Offer, error) {
	row := pool.QueryRow(ctx, `select `+selectColumns+` `+fromClause+` where o.id = $1`, id)
	o, err := scanOffer(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query offer: %w", err)
	}
	return &o, nil
}

func listBy(ctx context.Context, pool *pgxpool.Pool, whereCol, id string) ([]Offer, error) {
	rows, err := pool.Query(ctx, `
		select `+selectColumns+` `+fromClause+`
		where o.`+whereCol+` = $1
		order by o.created_at desc
	`, id)
	if err != nil {
		return nil, fmt.Errorf("query offers: %w", err)
	}
	defer rows.Close()

	out := []Offer{}
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			return nil, fmt.Errorf("scan offer: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ListSent is every offer buyerID has ever made, across every listing —
// backs the buyer-facing "my offers" view.
func ListSent(ctx context.Context, pool *pgxpool.Pool, buyerID string) ([]Offer, error) {
	return listBy(ctx, pool, "buyer_id", buyerID)
}

// ListReceived is every offer sellerID has ever received, across every
// listing they sell — backs the seller-facing "offers on my listings" view.
func ListReceived(ctx context.Context, pool *pgxpool.Pool, sellerID string) ([]Offer, error) {
	return listBy(ctx, pool, "seller_id", sellerID)
}

// ListForListing is every offer on one specific listing — callerID must be
// that listing's own seller (an offer's existence and amount are between
// the buyer and seller, never visible to other browsers of the listing,
// same "push the trust boundary into our own code" posture as everywhere
// else ownership is checked in this codebase).
func ListForListing(ctx context.Context, pool *pgxpool.Pool, listingID, callerID string) ([]Offer, error) {
	var sellerID string
	if err := pool.QueryRow(ctx, `select seller_id from listings where id = $1`, listingID).Scan(&sellerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read listing: %w", err)
	}
	if sellerID != callerID {
		return nil, ErrNotParticipant
	}
	return listBy(ctx, pool, "listing_id", listingID)
}
