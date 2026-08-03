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
)

// AllowDevDurations gates the short (1/2/5-minute) auction durations used to
// dissect the bidding engine without waiting days for a real auction to
// close. Set once at startup in cmd/api/main.go from platform.Config's
// Environment — never flip this per-request. See CLAUDE.md §6.1.
var AllowDevDurations = true

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
	ID                string    `json:"id"`
	SellerID          string    `json:"sellerId"`
	SellerUsername    *string   `json:"sellerUsername"`
	Title             string    `json:"title"`
	Game              string    `json:"game"`
	SetName           string    `json:"set"`
	CardNumber        *string   `json:"cardNumber,omitempty"`
	Rarity            *string   `json:"rarity,omitempty"`
	Condition         string    `json:"condition"`
	IsGraded          bool      `json:"isGraded"`
	GradingCompany    *string   `json:"gradingCompany,omitempty"`
	Grade             *string   `json:"grade,omitempty"`
	CertNumber        *string   `json:"certNumber,omitempty"`
	Format            Format    `json:"format"`
	PriceCents        *int64    `json:"priceCents,omitempty"`
	FreeShipping      bool      `json:"freeShipping"`
	ShippingCostCents int64     `json:"shippingCostCents"`
	ImageUrls         []string  `json:"imageUrls"`
	WatcherCount      int       `json:"watcherCount"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`

	StartingBidCents  *int64     `json:"startingBidCents,omitempty"`
	CurrentPriceCents *int64     `json:"currentPriceCents,omitempty"`
	HighBidderID      *string    `json:"highBidderId,omitempty"`
	BidCount          *int32     `json:"bidCount,omitempty"`
	EndsAt            *time.Time `json:"endsAt,omitempty"`

	// Outcome is set once cmd/worker's auction-close pass has processed
	// this listing (internal/auction/close.go): "sold" if it had a high
	// bidder when it closed, "no_bids" if it never got one. Nil until then
	// — including for the entire lifetime of a still-active auction.
	Outcome *string `json:"outcome,omitempty"`
}

type CreateInput struct {
	Title             string   `json:"title"`
	Game              string   `json:"game"`
	SetName           string   `json:"set"`
	CardNumber        string   `json:"cardNumber"`
	Rarity            string   `json:"rarity"`
	Condition         string   `json:"condition"`
	IsGraded          bool     `json:"isGraded"`
	GradingCompany    string   `json:"gradingCompany"`
	Grade             string   `json:"grade"`
	CertNumber        string   `json:"certNumber"`
	Format            Format   `json:"format"`
	PriceCents        int64    `json:"priceCents"`       // fixed-price listings
	StartingBidCents  int64    `json:"startingBidCents"` // auction listings
	DurationMinutes   int64    `json:"durationMinutes"`  // auction listings — see auctionDuration
	FreeShipping      bool     `json:"freeShipping"`
	ShippingCostCents int64    `json:"shippingCostCents"`
	ImageUrls         []string `json:"imageUrls"`
}

const selectColumns = `
	l.id, l.seller_id, u.username, l.title, l.game, l.set_name, l.card_number, l.rarity, l.condition,
	l.is_graded, l.grading_company, l.grade, l.cert_number, l.format, l.price_cents,
	l.free_shipping, l.shipping_cost_cents, l.image_urls,
	(select count(*) from watchlist w where w.listing_id = l.id) as watcher_count,
	l.status, l.created_at,
	a.starting_bid_cents, a.current_price_cents, a.high_bidder_id, a.bid_count, a.ends_at, a.outcome
`
const fromClause = `
	from listings l
	left join auctions a on a.listing_id = l.id
	join users u on u.id = l.seller_id
`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanListing(row rowScanner) (Listing, error) {
	var lst Listing
	var format string
	err := row.Scan(
		&lst.ID, &lst.SellerID, &lst.SellerUsername, &lst.Title, &lst.Game, &lst.SetName, &lst.CardNumber, &lst.Rarity, &lst.Condition,
		&lst.IsGraded, &lst.GradingCompany, &lst.Grade, &lst.CertNumber, &format, &lst.PriceCents,
		&lst.FreeShipping, &lst.ShippingCostCents, &lst.ImageUrls, &lst.WatcherCount, &lst.Status, &lst.CreatedAt,
		&lst.StartingBidCents, &lst.CurrentPriceCents, &lst.HighBidderID, &lst.BidCount, &lst.EndsAt, &lst.Outcome,
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
	if len(in.ImageUrls) == 0 {
		return nil, fmt.Errorf("%w: at least one photo is required", ErrInvalidInput)
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
			free_shipping, shipping_cost_cents, image_urls)
		values ($1,$2,$3,$4,nullif($5,''),nullif($6,''),$7,$8,nullif($9,''),nullif($10,''),nullif($11,''),$12,$13,$14,$15,$16)
		returning id
	`,
		sellerID, in.Title, in.Game, in.SetName, in.CardNumber, in.Rarity, in.Condition,
		in.IsGraded, in.GradingCompany, in.Grade, in.CertNumber, string(in.Format), priceCents,
		in.FreeShipping, in.ShippingCostCents, imageUrls,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("insert listing: %w", err)
	}

	if in.Format == FormatAuction {
		endsAt := time.Now().Add(auctionLength)
		if _, err := tx.Exec(ctx, `
			insert into auctions (listing_id, starting_bid_cents, current_price_cents, ends_at)
			values ($1, $2, $2, $3)
		`, id, in.StartingBidCents, endsAt); err != nil {
			return nil, fmt.Errorf("insert auction: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return Get(ctx, pool, id)
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

// ListFilters is every optional filter ListActive accepts. Nil pointer
// fields mean "not set" — distinct from a zero value, since e.g. a
// PriceMinCents of 0 is a meaningful filter (nothing free) but should be
// distinguishable from "no minimum given at all".
type ListFilters struct {
	SellerID string // scopes to one seller — the "Selling" page (§6.12)
	Game     string // category-bubble filter (§6.14)
	Search   string // title ILIKE — the search box (§6.14)

	// Finished shows auctions whose clock has run out, whether or not they
	// ever received a bid — named for "stopped accepting bids", not "Sold":
	// without a real Order/escrow model yet (§6.15, §5.1/§7) an auction's
	// own Outcome field ("sold" vs "no_bids", set by cmd/worker's close
	// pass, internal/auction/close.go) is the closest thing to a confirmed
	// sale, not an actual paid/shipped transaction.
	// When false (default), ended auctions are excluded from results
	// entirely — matching how a live marketplace only shows what's still
	// actually for sale.
	Finished bool

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
// bubbles + search box, and the Filters sidebar. v1 search is a plain
// ILIKE, not Postgres full-text — matches CLAUDE.md §6.7's "don't build a
// learned/full-text ranking before there's a real need" call; upgrade path
// is there if title-substring matching stops being good enough.
func ListActive(ctx context.Context, pool *pgxpool.Pool, f ListFilters) ([]Listing, error) {
	// cmd/worker's auction-close pass (internal/auction/close.go) flips a
	// listing's status to 'ended' once its clock runs out, so Finished
	// results have to match that status instead of 'active'. Also accept
	// 'active' in the Finished case: there's a small window between an
	// auction's ends_at passing and the worker's next tick actually
	// closing it, and a just-ended auction shouldn't vanish from Finished
	// results during that window just because status hasn't caught up yet
	// — the ends_at check below is what actually decides "finished" either way.
	statuses := []string{"active"}
	if f.Finished {
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
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		query += fmt.Sprintf(` and l.title ilike $%d`, len(args))
	}

	if f.Finished {
		query += ` and l.format = 'auction' and a.ends_at < now()`
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
	// wrong, since a finished auction's ends_at is in the past) once
	// Finished is set, so skip it entirely rather than let the slider's
	// default 0-hour minimum silently exclude every finished result.
	if !f.Finished {
		if f.TimeLeftMinHours != nil {
			args = append(args, time.Now().Add(time.Duration(*f.TimeLeftMinHours*float64(time.Hour))))
			query += fmt.Sprintf(` and (l.format = 'fixed' or a.ends_at >= $%d)`, len(args))
		}
		if f.TimeLeftMaxHours != nil {
			args = append(args, time.Now().Add(time.Duration(*f.TimeLeftMaxHours*float64(time.Hour))))
			query += fmt.Sprintf(` and (l.format = 'fixed' or a.ends_at <= $%d)`, len(args))
		}
	}

	query += ` order by l.created_at desc`

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
