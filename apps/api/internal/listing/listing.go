package listing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/catalog"
	"auctionhous-tcg/api/internal/notification"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
	"auctionhous-tcg/api/internal/user"
)

type Format string

const (
	FormatAuction Format = "auction"
	FormatFixed   Format = "fixed"
)

var (
	ErrInvalidGame         = errors.New("invalid game")
	ErrInvalidFormat       = errors.New("format must be \"auction\" or \"fixed\"")
	ErrInvalidInput        = errors.New("missing required listing fields")
	ErrInvalidDuration     = errors.New("invalid auction duration")
	ErrNotFound            = errors.New("listing not found")
	ErrSellerHasNoUsername = errors.New("you must set a username before creating a listing")
	ErrSelfPurchase        = errors.New("sellers cannot buy their own listing")
	ErrAlreadySold         = errors.New("this listing has already sold")
	ErrNotFixedFormat      = errors.New("this listing is not a fixed-price listing")
	ErrSellerNotOnboarded  = errors.New("you need to finish setting up payouts before you can list an item")
)

// AllowDevDurations gates the short (1/2/5-minute) auction durations used to
// dissect the bidding engine without waiting days for a real auction to
// close. Set once at startup in cmd/api/main.go from platform.Config's
// Environment — never flip this per-request. See CLAUDE.md §6.1.
var AllowDevDurations = true

// AllowMissingPhotos gates letting a listing skip photos entirely — set
// alongside AllowDevDurations from the same APP_ENV check, same reasoning:
// a real listing still requires at least one photo (§6.13), this only
// exists so the dev-only quick-list tool (app/dev/quick-list) can create
// throwaway test auctions without the normal upload flow. A skipped
// listing's imageUrls stays an empty array, which ListingImage/CardArt on
// the frontend already render as the gradient placeholder — no fake photo
// URL involved.
var AllowMissingPhotos = true

// RequireSellerOnboarded gates listing creation on the seller having
// finished Stripe Connect onboarding (design doc v2 §5.1) — set once at
// startup in cmd/api/main.go from paymentClient.IsConfigured(), same
// pattern as AllowDevDurations/AllowMissingPhotos. Off (false) when Stripe
// isn't configured at all, so local dev without Stripe keys can still
// create listings freely — same graceful-degradation posture as
// everywhere else Stripe is optional in this codebase. Deliberately does
// NOT gate on chargesEnabled alone at the HTTP layer only: this check
// lives in Create itself so a direct API call can't bypass the UI prompt
// (app/sell) the way a client-side-only check could.
var RequireSellerOnboarded = false

// prodAuctionDurations mirrors the real product decision (CLAUDE.md §6.1):
// auctions run 2 days, 3.5 days, or 7 days — nothing else.
var prodAuctionDurations = map[int64]time.Duration{
	2 * 24 * 60: 2 * 24 * time.Hour,
	5040:        84 * time.Hour, // 3.5 days, in minutes
	7 * 24 * 60: 7 * 24 * time.Hour,
}

// devAuctionDurations exist only to let development test the bidding engine
// end-to-end without waiting days per auction — gated by AllowDevDurations,
// never valid once APP_ENV=production.
var devAuctionDurations = map[int64]time.Duration{
	1: time.Minute,
	2: 2 * time.Minute,
	5: 5 * time.Minute,
}

func auctionDuration(durationMinutes int64) (time.Duration, bool) {
	if d, ok := prodAuctionDurations[durationMinutes]; ok {
		return d, true
	}
	if AllowDevDurations {
		if d, ok := devAuctionDurations[durationMinutes]; ok {
			return d, true
		}
	}
	return 0, false
}

// Listing is both the domain model and the JSON API shape — there's no
// separate DTO layer yet at this size. StartingBidCents/CurrentPriceCents/
// HighBidderID/BidCount/EndsAt are only populated for auction-format
// listings (joined from the auctions table).
type Listing struct {
	ID             string  `json:"id"`
	SellerID       string  `json:"sellerId"`
	SellerUsername *string `json:"sellerUsername"`
	// SellerRatingAvg/SellerReviewCount are real aggregates over
	// seller_reviews (internal/feedback), same "derive, never fabricate"
	// rule as everywhere else real numbers are shown (watcherCount, etc.)
	// — 0/0 for a seller with no reviews yet, never a placeholder rating.
	SellerRatingAvg   float64 `json:"sellerRatingAvg"`
	SellerReviewCount int     `json:"sellerReviewCount"`
	// SellerTier is design doc v2 §3's trust tier (internal/seller.Tier)
	// — always real, 'new' being the honest default rather than a
	// placeholder, same "derive, never fabricate" rule as the rating
	// aggregates above.
	SellerTier        string  `json:"sellerTier"`
	Title             string  `json:"title"`
	Game              string  `json:"game"`
	SetName           string  `json:"set"`
	CardNumber        *string `json:"cardNumber,omitempty"`
	Rarity            *string `json:"rarity,omitempty"`
	Condition         string  `json:"condition"`
	IsGraded          bool    `json:"isGraded"`
	GradingCompany    *string `json:"gradingCompany,omitempty"`
	Grade             *string `json:"grade,omitempty"`
	CertNumber        *string `json:"certNumber,omitempty"`
	Format            Format  `json:"format"`
	PriceCents        *int64  `json:"priceCents,omitempty"`
	FreeShipping      bool    `json:"freeShipping"`
	ShippingCostCents int64   `json:"shippingCostCents"`
	// ShippingTier is the seller's chosen preset at listing time
	// (internal/shipping.Tier's three values) — "the floor," not
	// necessarily what the item ships at: a low-starting-bid auction that
	// closes above $500 still ships signature-tier regardless of what's
	// recorded here, since order.CreateFromWin combines this with
	// shipping.RequiredTier(finalPrice) and keeps whichever is stricter.
	// See internal/shipping's package doc for the full policy.
	ShippingTier string    `json:"shippingTier"`
	ImageUrls    []string  `json:"imageUrls"`
	WatcherCount int       `json:"watcherCount"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`

	StartingBidCents  *int64     `json:"startingBidCents,omitempty"`
	CurrentPriceCents *int64     `json:"currentPriceCents,omitempty"`
	HighBidderID      *string    `json:"highBidderId,omitempty"`
	BidCount          *int32     `json:"bidCount,omitempty"`
	EndsAt            *time.Time `json:"endsAt,omitempty"`

	// BuyItNowPriceCents is only ever set on an auction-format listing —
	// it's the optional "skip the bidding entirely" price (CLAUDE.md's
	// Buy It Now feature). Nil means this is a plain auction, unchanged
	// from before this existed. A fixed-format listing doesn't need this
	// field at all — its own PriceCents already is its Buy It Now price.
	BuyItNowPriceCents *int64 `json:"buyItNowPriceCents,omitempty"`

	// Outcome is set once cmd/worker's auction-close pass, or a Buy It Now
	// purchase (internal/auction/buynow.go), has processed this listing:
	// "sold" (won via bidding), "no_bids", or "bought_now" (purchased
	// outright, skipping bidding). Nil until then — including for the
	// entire lifetime of a still-active auction.
	Outcome *string `json:"outcome,omitempty"`

	// ClosedAt is when an auction actually closed — distinct from EndsAt
	// (the originally scheduled end time), since a Buy It Now purchase
	// closes an auction before its clock runs out. Nil until closed.
	ClosedAt *time.Time `json:"closedAt,omitempty"`

	// BuyerID/SoldAt are only ever set for a *fixed*-format listing bought
	// via Buy It Now (listing.BuyNowFixed) — a fixed listing has no
	// auctions row to record this on, unlike an auction (whose equivalent
	// fact is ClosedAt above). Both nil until bought.
	BuyerID *string    `json:"buyerId,omitempty"`
	SoldAt  *time.Time `json:"soldAt,omitempty"`

	// PaidAt is set only when a real Stripe capture actually succeeded for
	// this purchase (internal/auction.HandleBuyNow, after the atomic
	// purchase itself already committed) — coalesced from whichever table
	// actually applies (listings.paid_at for a fixed-format purchase,
	// auctions.paid_at for an auction one). Nil for a purchase made
	// through the no-Stripe mock-payment path (nothing was ever charged)
	// or a plain auction win via bidding (no checkout step exists for that
	// yet) — both cases are genuinely still awaiting payment, not a
	// placeholder value.
	PaidAt *time.Time `json:"paidAt,omitempty"`

	// BuyerUsername mirrors SellerUsername but for whoever actually bought
	// this listing (l.buyer_id for a fixed-format sale, a.high_bidder_id
	// for an auction one that closed with a winner) — joined the same way,
	// nil until there's an actual buyer to name (an active, unsold
	// listing, or an auction with outcome 'no_bids'). Backs Sold History,
	// the seller-side mirror of Buy History's own sellerUsername column.
	BuyerUsername *string `json:"buyerUsername,omitempty"`
}

type CreateInput struct {
	Title            string `json:"title"`
	Game             string `json:"game"`
	SetName          string `json:"set"`
	CardNumber       string `json:"cardNumber"`
	Rarity           string `json:"rarity"`
	Condition        string `json:"condition"`
	IsGraded         bool   `json:"isGraded"`
	GradingCompany   string `json:"gradingCompany"`
	Grade            string `json:"grade"`
	CertNumber       string `json:"certNumber"`
	Format           Format `json:"format"`
	PriceCents       int64  `json:"priceCents"`       // fixed-price listings
	StartingBidCents int64  `json:"startingBidCents"` // auction listings
	DurationMinutes  int64  `json:"durationMinutes"`  // auction listings — see auctionDuration
	// BuyItNowPriceCents is optional and only meaningful when Format ==
	// FormatAuction — "Auction, Buy It Now, or Both" (the product ask):
	// auction alone is Format=auction with this left at 0; fixed-price
	// alone is Format=fixed (its own PriceCents is the Buy It Now price);
	// "both" is Format=auction with this set to a real price.
	BuyItNowPriceCents int64 `json:"buyItNowPriceCents"`
	FreeShipping       bool  `json:"freeShipping"`
	ShippingCostCents  int64 `json:"shippingCostCents"`
	// ShippingTier is one of shipping.TierStandard/TierTracked/
	// TierSignature — defaults to TierStandard when empty (the common
	// bubble-mailer case), validated in Create against Tier.Valid().
	ShippingTier string   `json:"shippingTier"`
	ImageUrls    []string `json:"imageUrls"`
}

const selectColumns = `
	l.id, l.seller_id, u.username,
	coalesce((
		select avg((sr.condition_accuracy + sr.shipping_speed + sr.trustworthiness) / 3.0)
		from seller_reviews sr where sr.seller_id = l.seller_id
	), 0) as seller_rating_avg,
	(select count(*) from seller_reviews sr2 where sr2.seller_id = l.seller_id) as seller_review_count,
	u.tier,
	l.title, l.game, l.set_name, l.card_number, l.rarity, l.condition,
	l.is_graded, l.grading_company, l.grade, l.cert_number, l.format, l.price_cents,
	l.free_shipping, l.shipping_cost_cents, l.shipping_tier, l.image_urls,
	(select count(*) from watchlist w where w.listing_id = l.id) as watcher_count,
	l.status, l.created_at, l.buyer_id, l.sold_at,
	a.starting_bid_cents, a.current_price_cents, a.high_bidder_id, a.bid_count, a.ends_at, a.outcome,
	a.buy_it_now_price_cents, a.closed_at, coalesce(l.paid_at, a.paid_at), bu.username
`
const fromClause = `
	from listings l
	left join auctions a on a.listing_id = l.id
	join users u on u.id = l.seller_id
	left join users bu on bu.id = coalesce(l.buyer_id, case when a.outcome in ('sold', 'bought_now') then a.high_bidder_id end)
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanListing(row rowScanner) (Listing, error) {
	var lst Listing
	var format string
	err := row.Scan(
		&lst.ID, &lst.SellerID, &lst.SellerUsername, &lst.SellerRatingAvg, &lst.SellerReviewCount, &lst.SellerTier,
		&lst.Title, &lst.Game, &lst.SetName, &lst.CardNumber, &lst.Rarity, &lst.Condition,
		&lst.IsGraded, &lst.GradingCompany, &lst.Grade, &lst.CertNumber, &format, &lst.PriceCents,
		&lst.FreeShipping, &lst.ShippingCostCents, &lst.ShippingTier, &lst.ImageUrls, &lst.WatcherCount, &lst.Status, &lst.CreatedAt, &lst.BuyerID, &lst.SoldAt,
		&lst.StartingBidCents, &lst.CurrentPriceCents, &lst.HighBidderID, &lst.BidCount, &lst.EndsAt, &lst.Outcome,
		&lst.BuyItNowPriceCents, &lst.ClosedAt, &lst.PaidAt, &lst.BuyerUsername,
	)
	if err != nil {
		return Listing{}, err
	}
	lst.Format = Format(format)
	return lst, nil
}

func Create(ctx context.Context, pool *pgxpool.Pool, sellerID string, in CreateInput) (*Listing, error) {
	if err := user.RequireUsername(ctx, pool, sellerID); err != nil {
		if errors.Is(err, user.ErrNoUsername) {
			return nil, ErrSellerHasNoUsername
		}
		return nil, fmt.Errorf("check seller username: %w", err)
	}
	if RequireSellerOnboarded {
		accountID, err := seller.RequirePayoutsEnabled(ctx, pool, sellerID)
		if err != nil {
			return nil, fmt.Errorf("check seller connect status: %w", err)
		}
		if accountID == "" {
			return nil, ErrSellerNotOnboarded
		}
	}
	if !catalog.IsValidGame(in.Game) {
		return nil, ErrInvalidGame
	}
	if in.Format != FormatAuction && in.Format != FormatFixed {
		return nil, ErrInvalidFormat
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if in.Format == FormatFixed && in.PriceCents <= 0 {
		return nil, fmt.Errorf("%w: priceCents must be positive for a fixed-price listing", ErrInvalidInput)
	}
	if in.Format == FormatAuction && in.StartingBidCents <= 0 {
		return nil, fmt.Errorf("%w: startingBidCents must be positive for an auction", ErrInvalidInput)
	}
	if in.BuyItNowPriceCents != 0 {
		if in.Format != FormatAuction {
			return nil, fmt.Errorf("%w: buyItNowPriceCents only applies to auction-format listings", ErrInvalidInput)
		}
		if in.BuyItNowPriceCents <= in.StartingBidCents {
			return nil, fmt.Errorf("%w: buyItNowPriceCents must be greater than startingBidCents", ErrInvalidInput)
		}
	}
	if len(in.ImageUrls) == 0 && !AllowMissingPhotos {
		return nil, fmt.Errorf("%w: at least one photo is required", ErrInvalidInput)
	}
	shippingTier := in.ShippingTier
	if shippingTier == "" {
		shippingTier = string(shipping.TierStandard)
	}
	if !shipping.Tier(shippingTier).Valid() {
		return nil, fmt.Errorf("%w: shippingTier must be \"standard\", \"tracked\", or \"signature\"", ErrInvalidInput)
	}
	var auctionLength time.Duration
	if in.Format == FormatAuction {
		d, ok := auctionDuration(in.DurationMinutes)
		if !ok {
			return nil, fmt.Errorf("%w: durationMinutes must be one of the allowed auction lengths", ErrInvalidDuration)
		}
		auctionLength = d
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var priceCents *int64
	if in.Format == FormatFixed {
		priceCents = &in.PriceCents
	}

	imageUrls := in.ImageUrls
	if imageUrls == nil {
		imageUrls = []string{}
	}

	var id string
	err = tx.QueryRow(ctx, `
		insert into listings (seller_id, title, game, set_name, card_number, rarity, condition,
			is_graded, grading_company, grade, cert_number, format, price_cents,
			free_shipping, shipping_cost_cents, shipping_tier, image_urls)
		values ($1,$2,$3,$4,nullif($5,''),nullif($6,''),$7,$8,nullif($9,''),nullif($10,''),nullif($11,''),$12,$13,$14,$15,$16,$17)
		returning id
	`,
		sellerID, in.Title, in.Game, in.SetName, in.CardNumber, in.Rarity, in.Condition,
		in.IsGraded, in.GradingCompany, in.Grade, in.CertNumber, string(in.Format), priceCents,
		in.FreeShipping, in.ShippingCostCents, shippingTier, imageUrls,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("insert listing: %w", err)
	}

	if in.Format == FormatAuction {
		endsAt := time.Now().Add(auctionLength)
		var buyItNowPriceCents *int64
		if in.BuyItNowPriceCents > 0 {
			buyItNowPriceCents = &in.BuyItNowPriceCents
		}
		if _, err := tx.Exec(ctx, `
			insert into auctions (listing_id, starting_bid_cents, current_price_cents, ends_at, buy_it_now_price_cents)
			values ($1, $2, $2, $3, $4)
		`, id, in.StartingBidCents, endsAt, buyItNowPriceCents); err != nil {
			return nil, fmt.Errorf("insert auction: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return Get(ctx, pool, id)
}

// BuyNowFixed buys a fixed-format listing outright — the entire purchase
// path for a format that was always "Buy It Now only" (its price_cents IS
// the Buy It Now price), just missing anywhere to record who bought it
// until now. Race-safe the same way auction close/bid placement are
// (CLAUDE.md §5.3): the update below is a compare-and-swap guarded on
// status = 'active', so two simultaneous buyers can never both "win" the
// same listing — the loser's update affects zero rows and gets
// ErrAlreadySold, not a silently-overwritten sale.
func BuyNowFixed(ctx context.Context, pool *pgxpool.Pool, listingID, buyerID string) (*Listing, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		sellerID string
		format   string
		status   string
	)
	err = tx.QueryRow(ctx, `
		select seller_id, format, status from listings where id = $1 for update
	`, listingID).Scan(&sellerID, &format, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read listing: %w", err)
	}

	if format != string(FormatFixed) {
		return nil, ErrNotFixedFormat
	}
	if buyerID == sellerID {
		return nil, ErrSelfPurchase
	}
	if status != "active" {
		return nil, ErrAlreadySold
	}

	tag, err := tx.Exec(ctx, `
		update listings set status = 'ended', buyer_id = $1, sold_at = now()
		where id = $2 and status = 'active'
	`, buyerID, listingID)
	if err != nil {
		return nil, fmt.Errorf("update listing: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAlreadySold
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

	return Get(ctx, pool, listingID)
}

func Get(ctx context.Context, pool *pgxpool.Pool, id string) (*Listing, error) {
	row := pool.QueryRow(ctx, `select `+selectColumns+` `+fromClause+` where l.id = $1`, id)
	lst, err := scanListing(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query listing: %w", err)
	}
	return &lst, nil
}

// GetMany batch-fetches every listing in ids in a single query, keyed by
// id — exists so callers that need N listings (auction.MyBids, one per
// bid row) do one round trip instead of N calls to Get. That N+1 pattern
// measurably slowed the Buying page down once a bidder had more than a
// handful of bids (18 bids meant 18 sequential round trips to a remote
// Postgres instance, ~1.8s just for that one endpoint).
func GetMany(ctx context.Context, pool *pgxpool.Pool, ids []string) (map[string]Listing, error) {
	if len(ids) == 0 {
		return map[string]Listing{}, nil
	}
	rows, err := pool.Query(ctx, `select `+selectColumns+` `+fromClause+` where l.id = any($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("query listings: %w", err)
	}
	defer rows.Close()

	out := make(map[string]Listing, len(ids))
	for rows.Next() {
		lst, err := scanListing(rows)
		if err != nil {
			return nil, fmt.Errorf("scan listing: %w", err)
		}
		out[lst.ID] = lst
	}
	return out, rows.Err()
}

// ListFilters is every optional filter ListActive accepts. Nil pointer
// fields mean "not set" — distinct from a zero value, since e.g. a
// PriceMinCents of 0 is a meaningful filter (nothing free) but should be
// distinguishable from "no minimum given at all".
type ListFilters struct {
	SellerID string // scopes to one seller — the "Selling" page (§6.12)
	Game     string // category-bubble filter (§6.14)
	Search   string // cross-field + typo-tolerant match — the search box (§6.14, §6.7)

	// Sold shows only listings that actually sold — a fixed-price listing
	// with a real buyer_id, or an auction whose outcome is "sold" (won via
	// bidding) or "bought_now" (Buy It Now on an auction listing). An
	// auction that timed out with no bids at all (outcome = "no_bids")
	// never qualifies here even though it's equally "ended" — it isn't a
	// sale, so it must never appear under a filter labeled Sold. This is
	// the closest thing to a confirmed sale without internal/order wired
	// in yet (design doc v2 §5) — not an actual paid/shipped transaction;
	// see paid_at (migration 0019) for the one piece of that this app does
	// track for real.
	// When false (default), unsold/still-active listings are all that's
	// returned — matching how a live marketplace only shows what's still
	// actually for sale.
	Sold bool

	// FixedOnly is the "Buy It Now" toggle — restricts to fixed-price
	// listings, hiding every auction.
	FixedOnly bool

	PriceMinCents *int64
	PriceMaxCents *int64

	// ConditionMin is a minimum-condition threshold (one of
	// catalog.ConditionOrder) — e.g. "Lightly Played" shows Lightly Played
	// and Near Mint raw cards. Graded slabs are never excluded by this,
	// since "condition" isn't a concept that applies to them (§6.15).
	ConditionMin string

	// TimeLeftMinHours/TimeLeftMaxHours bound how soon an auction ends,
	// e.g. "ending within 24 hours". Fixed-price listings have no end time
	// and are never excluded by this filter, for the same reason graded
	// slabs aren't excluded by ConditionMin — the filter doesn't apply to
	// them, so it shouldn't hide them.
	TimeLeftMinHours *float64
	TimeLeftMaxHours *float64
}

// ListActive returns active listings matching every set filter (§6.14,
// §6.15) — the real data behind the "Selling" page, the homepage category
// bubbles + search box, and the Filters sidebar. Search matches across every
// item-specific field (not just title) and tolerates typos/spacing via
// Postgres trigram similarity (pg_trgm, migration 0029). Title and every
// other field ("tags" — game/set/card number/rarity/condition/grading, §6.16)
// are matched with equal recall but ranked with title weighted higher, so
// e.g. a bare card number search still finds the listing but a title hit
// always sorts first — see the ORDER BY below. Still no dedicated search
// engine or learned ranking, matching CLAUDE.md §6.7's "don't build that
// before there's a real need" call; a Cassini-style score that also factors
// in seller tier/listing quality is the documented v2 upgrade path, not a
// v1 requirement — this is fixed-weight relevance, not a learned one.
func ListActive(ctx context.Context, pool *pgxpool.Pool, f ListFilters) ([]Listing, error) {
	// cmd/worker's auction-close pass (internal/auction/close.go) flips a
	// listing's status to 'ended' once its clock runs out, so Sold results
	// have to match that status instead of 'active'. Also accept 'active'
	// in the Sold case: there's a small window between a listing actually
	// selling and its status catching up (a Buy It Now purchase or
	// close.go's outcome update happen first) — the buyer_id/outcome check
	// below is what actually decides "sold" either way, this just widens
	// the status net enough not to miss it.
	statuses := []string{"active"}
	if f.Sold {
		statuses = []string{"active", "ended"}
	}
	query := `select ` + selectColumns + ` ` + fromClause + ` where l.status = any($1)`
	args := []any{statuses}

	if f.SellerID != "" {
		args = append(args, f.SellerID)
		query += fmt.Sprintf(` and l.seller_id = $%d`, len(args))
	}
	if f.Game != "" {
		args = append(args, f.Game)
		query += fmt.Sprintf(` and l.game = $%d`, len(args))
	}
	// searchArgIdx tracks the placeholder holding the raw query (not "%...%"
	// wrapped, since word_similarity needs the bare string) so the ORDER BY
	// below can reuse it without re-deriving its position among the other
	// optional filters.
	searchArgIdx := 0
	if f.Search != "" {
		args = append(args, f.Search)
		searchArgIdx = len(args)
		// search_text (migration 0029) concatenates title/game/set/card
		// number/rarity/condition/grading fields, so a query matches
		// anywhere a shopper might expect — not just the title — fixing
		// "Pokemon" (lives in the game column) returning nothing. The ILIKE
		// half is the cheap exact-substring case; word_similarity is the
		// typo/spacing-tolerant fallback (pg_trgm, CLAUDE.md §6.7) that
		// makes "Ckarizard" or "DarkRai" still find "Charizard"/"Dark Rai".
		// 0.3 is a starting threshold — loose enough to forgive real typos
		// without matching on noise; revisit once there's real query volume
		// to tune against.
		query += fmt.Sprintf(
			` and (l.search_text ilike '%%' || $%d || '%%' or word_similarity($%d, l.search_text) > 0.3)`,
			searchArgIdx, searchArgIdx,
		)
	}

	if f.Sold {
		// l.buyer_id is the authoritative "this fixed listing actually
		// sold" signal (set synchronously by BuyNowFixed); a.outcome in
		// ('sold', 'bought_now') is the auction equivalent — 'sold' means
		// won via bidding, 'bought_now' means purchased outright before the
		// clock ran out. Deliberately does NOT match on l.status = 'ended'
		// or a.ends_at alone — an auction that timed out with zero bids is
		// just as "ended" but has outcome = 'no_bids', and must never show
		// up under Sold since it never actually sold.
		query += ` and (l.buyer_id is not null or (l.format = 'auction' and a.outcome in ('sold', 'bought_now')))`
	} else {
		query += ` and (l.format = 'fixed' or a.ends_at > now())`
	}

	if f.FixedOnly {
		query += ` and l.format = 'fixed'`
	}

	if f.PriceMinCents != nil {
		args = append(args, *f.PriceMinCents)
		query += fmt.Sprintf(` and coalesce(a.current_price_cents, l.price_cents) >= $%d`, len(args))
	}
	if f.PriceMaxCents != nil {
		args = append(args, *f.PriceMaxCents)
		query += fmt.Sprintf(` and coalesce(a.current_price_cents, l.price_cents) <= $%d`, len(args))
	}

	if f.ConditionMin != "" {
		if eligible := catalog.ConditionsAtOrAbove(f.ConditionMin); len(eligible) > 0 {
			args = append(args, eligible)
			query += fmt.Sprintf(` and (l.is_graded = true or l.condition = any($%d))`, len(args))
		}
	}

	// "Time left" is a live-auction concept — meaningless (and actively
	// wrong, since a sold listing's ends_at is in the past) once Sold is
	// set, so skip it entirely rather than let the slider's default 0-hour
	// minimum silently exclude every sold result.
	if !f.Sold {
		if f.TimeLeftMinHours != nil {
			args = append(args, time.Now().Add(time.Duration(*f.TimeLeftMinHours*float64(time.Hour))))
			query += fmt.Sprintf(` and (l.format = 'fixed' or a.ends_at >= $%d)`, len(args))
		}
		if f.TimeLeftMaxHours != nil {
			args = append(args, time.Now().Add(time.Duration(*f.TimeLeftMaxHours*float64(time.Hour))))
			query += fmt.Sprintf(` and (l.format = 'fixed' or a.ends_at <= $%d)`, len(args))
		}
	}

	if searchArgIdx != 0 {
		// Best match first, but title and "tags" (everything else search_text
		// pulls in — game/set/card number/rarity/condition/grading, much of
		// it populated straight from the TCG Haven catalog autofill, §6.16)
		// are weighted separately rather than scored as one flat blob: a
		// title hit should always outrank a tags-only hit, but a tags-only
		// hit (e.g. searching a bare card number like "21/166", which is
		// almost never in the title) should still surface, just lower.
		// 0.7/0.3 mirrors title's outsized role in the old single-string
		// score while still letting tag matches place results a shopper
		// would otherwise get zero results for — revisit the split once
		// there's real query volume to tune against, same as the 0.3
		// similarity threshold above. Recency only breaks ties between
		// equally-relevant results.
		query += fmt.Sprintf(
			` order by (word_similarity($%d, l.title) * 0.7 + word_similarity($%d, l.game || ' ' || l.set_name || ' ' || coalesce(l.card_number, '') || ' ' || coalesce(l.rarity, '') || ' ' || l.condition || ' ' || coalesce(l.grading_company, '') || ' ' || coalesce(l.grade, '')) * 0.3) desc, l.created_at desc`,
			searchArgIdx, searchArgIdx,
		)
	} else {
		query += ` order by l.created_at desc`
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query listings: %w", err)
	}
	defer rows.Close()

	out := []Listing{}
	for rows.Next() {
		lst, err := scanListing(rows)
		if err != nil {
			return nil, fmt.Errorf("scan listing: %w", err)
		}
		out = append(out, lst)
	}
	return out, rows.Err()
}

// CountsByGame returns the number of active listings per game, across the
// whole site regardless of any filter — the real numbers shown next to each
// category bubble in CategoryNav (CLAUDE.md §6.14). Zero-filled for every
// game in catalog.AllGames so the frontend never has to guess whether a
// missing key means zero or means "not fetched yet."
//
// Must mirror ListActive's own "still available" condition
// (l.status = 'active' and (fixed-price or auction not yet ended)), not
// just l.status — cmd/worker's auction-close pass (internal/auction/close.go)
// only flips status to 'ended' on its next tick after ends_at passes, so a
// status-only filter here could still count an ended auction for up to one
// worker interval after ListActive has already stopped showing it.
func CountsByGame(ctx context.Context, pool *pgxpool.Pool) (map[string]int, error) {
	counts := make(map[string]int, len(catalog.AllGames))
	for _, g := range catalog.AllGames {
		counts[string(g)] = 0
	}

	rows, err := pool.Query(ctx, `
		select l.game, count(*)
		from listings l
		left join auctions a on a.listing_id = l.id
		where l.status = 'active' and (l.format = 'fixed' or a.ends_at > now())
		group by l.game
	`)
	if err != nil {
		return nil, fmt.Errorf("query listing counts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var game string
		var count int
		if err := rows.Scan(&game, &count); err != nil {
			return nil, fmt.Errorf("scan listing count: %w", err)
		}
		counts[game] = count
	}
	return counts, rows.Err()
}
