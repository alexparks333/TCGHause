package listing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/address"
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
	ErrNotOwner            = errors.New("you don't own this listing")
	ErrNotActive           = errors.New("this listing is no longer active")
	ErrHasBids             = errors.New("this auction already has bids and can't be removed")
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
	SellerTier     string  `json:"sellerTier"`
	Title          string  `json:"title"`
	Game           string  `json:"game"`
	SetName        string  `json:"set"`
	CardNumber     *string `json:"cardNumber,omitempty"`
	Rarity         *string `json:"rarity,omitempty"`
	Condition      string  `json:"condition"`
	IsGraded       bool    `json:"isGraded"`
	GradingCompany *string `json:"gradingCompany,omitempty"`
	Grade          *string `json:"grade,omitempty"`
	CertNumber     *string `json:"certNumber,omitempty"`
	Format         Format  `json:"format"`
	PriceCents     *int64  `json:"priceCents,omitempty"`
	// ShippingPreset is the seller's chosen shipping method at listing
	// time (internal/shipping.Preset's five values) — "the floor," not
	// necessarily what the item ships at: a low-starting-bid auction that
	// closes above $500 still ships signature-required regardless of
	// what's recorded here, since order.CreateFromWin resolves this
	// through shipping.UpgradePreset(finalPrice) and keeps whichever
	// mechanism that mandates. See internal/shipping's package doc for
	// the full policy. There's no separate FreeShipping/ShippingCostCents
	// pair anymore — free-ness is Preset.IsFree(), and the buyer-facing
	// cost is derived from the preset itself, never an arbitrary
	// seller-typed number.
	ShippingPreset string `json:"shippingPreset"`
	// EstimatedShippingCents is only ever populated for the
	// shippo_ground_advantage preset — a one-time rate-shop estimate
	// computed at creation time (see Create), shown on the listing so
	// buyers have a real number before the actual checkout-time quote.
	// Nil for every other preset (their cost is either $0 or the fixed
	// TrackedEnvelopeCents, no estimate needed).
	EstimatedShippingCents *int64 `json:"estimatedShippingCents,omitempty"`
	// RequestSignature is derived server-side (never client-supplied) from
	// whichever price the seller submitted at Create/Update time — see
	// shipping.RequestSignatureFromPrice. Distinct from the mandatory
	// $500-final-sale-price rule (shipping.SignatureRequiredCents): this
	// one fires off the listing's own starting bid/Buy It Now price, so a
	// seller listing something valuable gets locked into signature
	// confirmation from the moment the listing goes live, not just once it
	// actually sells for enough. shipping.UpgradePreset ORs the two rules
	// together at sale time.
	RequestSignature bool      `json:"requestSignature"`
	ImageUrls        []string  `json:"imageUrls"`
	WatcherCount     int       `json:"watcherCount"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`

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

	// AllowOffers/MinOfferCents (migration 0049) gate internal/offer's real
	// offer flow — a buyer can send an offer on this listing at all only
	// when AllowOffers is true, and only at or above MinOfferCents when the
	// seller set one. Only ever meaningful alongside a real Buy It Now
	// price (this listing's own PriceCents for a fixed listing,
	// BuyItNowPriceCents for an auction) — Create refuses to set
	// AllowOffers otherwise.
	AllowOffers   bool   `json:"allowOffers"`
	MinOfferCents *int64 `json:"minOfferCents,omitempty"`

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

	// SoldPriceCents is only set when a fixed-format listing sold for
	// something other than its own PriceCents — currently that's only an
	// accepted offer (internal/offer.Accept), which closes the listing at
	// the negotiated amount instead of the asking price. Nil means "sold at
	// PriceCents" (a plain Buy It Now purchase, or not sold at all yet) —
	// checkout.go and buynow.go's subtotal derivation both prefer this over
	// PriceCents when present, so an accepted offer is never overcharged
	// the original asking price at payment time. An auction's equivalent
	// negotiated price just overwrites CurrentPriceCents directly (there's
	// no separate "asking price" to preserve for an auction the way a fixed
	// listing's PriceCents needs to be), so this field is fixed-only.
	SoldPriceCents *int64 `json:"soldPriceCents,omitempty"`

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
	// AllowOffers/MinOfferCents mirror Listing's own fields — only valid
	// when a real Buy It Now price exists (PriceCents for fixed,
	// BuyItNowPriceCents for auction), see Create's validation. Zero-value
	// MinOfferCents (0, the JSON default when the field is omitted) means
	// "no minimum set" — a seller who allows offers without picking a
	// floor accepts any positive amount below the BIN price.
	AllowOffers   bool  `json:"allowOffers"`
	MinOfferCents int64 `json:"minOfferCents"`
	// ShippingPreset is one of shipping.Preset's five values — defaults to
	// PresetTrackedEnvelope when empty (matching the column's own db
	// default), validated in Create against Preset.Valid() plus the
	// free-preset/auction-format and free-preset/$100 restrictions
	// documented on shipping.UpgradePreset's own doc comment.
	ShippingPreset string   `json:"shippingPreset"`
	ImageUrls      []string `json:"imageUrls"`
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
	l.shipping_preset, l.estimated_shipping_cents, l.request_signature, l.image_urls,
	(select count(*) from watchlist w where w.listing_id = l.id) as watcher_count,
	l.status, l.created_at, l.buyer_id, l.sold_at,
	a.starting_bid_cents, a.current_price_cents, a.high_bidder_id, a.bid_count, a.ends_at, a.outcome,
	a.buy_it_now_price_cents, a.closed_at, coalesce(l.paid_at, a.paid_at), bu.username,
	l.allow_offers, l.min_offer_cents, l.sold_price_cents
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
		&lst.ShippingPreset, &lst.EstimatedShippingCents, &lst.RequestSignature, &lst.ImageUrls, &lst.WatcherCount, &lst.Status, &lst.CreatedAt, &lst.BuyerID, &lst.SoldAt,
		&lst.StartingBidCents, &lst.CurrentPriceCents, &lst.HighBidderID, &lst.BidCount, &lst.EndsAt, &lst.Outcome,
		&lst.BuyItNowPriceCents, &lst.ClosedAt, &lst.PaidAt, &lst.BuyerUsername,
		&lst.AllowOffers, &lst.MinOfferCents, &lst.SoldPriceCents,
	)
	if err != nil {
		return Listing{}, err
	}
	lst.Format = Format(format)
	return lst, nil
}

func Create(ctx context.Context, pool *pgxpool.Pool, sellerID string, in CreateInput, shippoClient *shipping.Client) (*Listing, error) {
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
	// A real Buy It Now price to measure offers against: a fixed listing's
	// own price, or an auction's optional buyItNowPriceCents (0/unset if
	// the seller didn't add one) — never the auction's starting bid, since
	// that isn't a real asking price an offer is "below."
	binPriceCents := in.PriceCents
	if in.Format == FormatAuction {
		binPriceCents = in.BuyItNowPriceCents
	}
	// The listing-time signature-request heuristic (shipping.
	// RequestSignatureFromPrice) — the "amount" it's checked against is
	// whichever of the listing's own prices is highest and already known
	// at creation time: a fixed listing's own price, an auction's Buy It
	// Now price if it has one, or its starting bid otherwise. Never the
	// eventual final sale price (unknowable yet for an auction) — that's
	// shipping.SignatureRequiredCents' job, applied later at sale time and
	// ORed with this one in shipping.UpgradePreset.
	referencePriceCents := binPriceCents
	if in.Format == FormatAuction && in.StartingBidCents > referencePriceCents {
		referencePriceCents = in.StartingBidCents
	}
	requestSignature := shipping.RequestSignatureFromPrice(referencePriceCents)
	if in.AllowOffers {
		if binPriceCents <= 0 {
			return nil, fmt.Errorf("%w: allowOffers requires a Buy It Now price", ErrInvalidInput)
		}
		if in.MinOfferCents != 0 {
			if in.MinOfferCents <= 0 {
				return nil, fmt.Errorf("%w: minOfferCents must be positive", ErrInvalidInput)
			}
			if in.MinOfferCents >= binPriceCents {
				return nil, fmt.Errorf("%w: minOfferCents must be less than the Buy It Now price", ErrInvalidInput)
			}
		}
	} else if in.MinOfferCents != 0 {
		return nil, fmt.Errorf("%w: minOfferCents only applies when allowOffers is true", ErrInvalidInput)
	}
	if len(in.ImageUrls) == 0 && !AllowMissingPhotos {
		return nil, fmt.Errorf("%w: at least one photo is required", ErrInvalidInput)
	}
	shippingPreset := in.ShippingPreset
	if shippingPreset == "" {
		shippingPreset = string(shipping.PresetTrackedEnvelope)
	}
	preset := shipping.Preset(shippingPreset)
	if !preset.Valid() {
		return nil, fmt.Errorf("%w: shippingPreset must be one of the 5 valid presets", ErrInvalidInput)
	}
	// Both free_envelope and tracked_envelope are only rejected outright
	// when the final price is already known (a fixed-price listing) and
	// already too high — an auction's final price isn't known yet, so
	// there's nothing to validate against here; shipping.UpgradePreset
	// resolves the real mechanism at sale time instead (free_envelope ->
	// free_bubble_mailer, still free; tracked_envelope ->
	// shippo_ground_advantage, since that one was never free to begin
	// with). All three free presets are otherwise valid on auctions —
	// free_bubble_mailer/free_box need no such check at all, since
	// they're already package-mechanism at any price.
	if in.Format == FormatFixed && preset.Mechanism() == shipping.MechanismLetter && in.PriceCents >= shipping.PackageRequiredCents {
		if preset.IsFree() {
			return nil, fmt.Errorf("%w: free envelope shipping isn't available on listings priced at $100 or more — pick free bubble mailer, free box, or a paid preset", ErrInvalidInput)
		}
		return nil, fmt.Errorf("%w: tracked envelope shipping isn't available on listings priced at $100 or more", ErrInvalidInput)
	}
	var auctionLength time.Duration
	if in.Format == FormatAuction {
		d, ok := auctionDuration(in.DurationMinutes)
		if !ok {
			return nil, fmt.Errorf("%w: durationMinutes must be one of the allowed auction lengths", ErrInvalidDuration)
		}
		auctionLength = d
	}

	// Computed before the transaction starts, not inside it — this is a
	// live HTTP call to Shippo, and holding a DB transaction open for the
	// duration of a network round trip is exactly the kind of thing that
	// starves the connection pool under load. A quote failure (Shippo not
	// configured, seller has no address yet, or the call itself errors)
	// is never fatal to listing creation — it just means the listing
	// shows no estimate yet, same graceful-degradation posture as every
	// other optional integration in this codebase.
	var estimatedShippingCents *int64
	if preset == shipping.PresetShippoGroundAdvantage && shippoClient.IsConfigured() {
		if sellerAddr, err := address.Get(ctx, pool, sellerID); err == nil {
			if sellerUser, err := user.Get(ctx, pool, sellerID); err == nil {
				if cents, err := shippoClient.QuoteRate(ctx, sellerAddr, shipping.ReferenceAddress, sellerUser.Email, sellerUser.Email, preset, requestSignature); err == nil {
					estimatedShippingCents = &cents
				}
			}
		}
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

	var minOfferCents *int64
	if in.AllowOffers && in.MinOfferCents > 0 {
		minOfferCents = &in.MinOfferCents
	}

	var id string
	err = tx.QueryRow(ctx, `
		insert into listings (seller_id, title, game, set_name, card_number, rarity, condition,
			is_graded, grading_company, grade, cert_number, format, price_cents,
			shipping_preset, estimated_shipping_cents, request_signature, image_urls, allow_offers, min_offer_cents)
		values ($1,$2,$3,$4,nullif($5,''),nullif($6,''),$7,$8,nullif($9,''),nullif($10,''),nullif($11,''),$12,$13,$14,$15,$16,$17,$18,$19)
		returning id
	`,
		sellerID, in.Title, in.Game, in.SetName, in.CardNumber, in.Rarity, in.Condition,
		in.IsGraded, in.GradingCompany, in.Grade, in.CertNumber, string(in.Format), priceCents,
		shippingPreset, estimatedShippingCents, requestSignature, imageUrls, in.AllowOffers, minOfferCents,
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
		// id isn't valid uuid syntax at all (a stale/hand-edited/bot-probed
		// URL, or — see CelebrationToast — a synthetic dev-test id that was
		// never a real listing) — that's "not found," not a server error,
		// same as ErrNoRows above.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "22P02" {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query listing: %w", err)
	}
	return &lst, nil
}

// Cancel is a "delete listing" as far as the Selling page is concerned, but
// never a real row deletion — orders, bids, watchlist entries, offers, and
// notifications all reference listings.id by foreign key, and a sold
// listing's own order/dispute/shipping history has to keep resolving
// against it. status already had 'cancelled' in its check constraint since
// the very first listings migration (0003) — this is that value's first
// real caller. ListActive's own status filter (l.status = any('active',
// 'ended')) means a cancelled listing just stops showing up anywhere
// active, same mechanism an auction ending naturally already uses.
func Cancel(ctx context.Context, pool *pgxpool.Pool, id, sellerID string) error {
	lst, err := Get(ctx, pool, id)
	if err != nil {
		return err
	}
	if lst.SellerID != sellerID {
		return ErrNotOwner
	}
	if lst.Status != "active" {
		return ErrNotActive
	}
	// Mirrors eBay's own restriction on ending a listing early once
	// bidding has started — a bidder who's already committed shouldn't
	// have the item pulled out from under them. A fixed-price listing has
	// no bidders to protect, so it only needs the still-active check above.
	if lst.Format == FormatAuction && lst.BidCount != nil && *lst.BidCount > 0 {
		return ErrHasBids
	}
	if _, err := pool.Exec(ctx, `update listings set status = 'cancelled' where id = $1`, id); err != nil {
		return fmt.Errorf("cancel listing: %w", err)
	}
	return nil
}

// UpdateInput backs the Selling page's Edit Listing form — deliberately
// modeled on eBay's own real "revise a listing" rules (confirmed against
// eBay's seller help docs), not an app-invented policy. Game and Condition
// still never change through this endpoint (game defines the whole
// item-specifics schema, §6.2; condition is a claim the buyer weighs when
// bidding/buying and is safer left to a fresh listing). Title, Set, Card
// Number, and Rarity, and the photos, are editable — see below — under the
// same rule as everything else here: what's actually editable depends
// entirely on format and bid state:
//
//   - Fixed-price ("Buy It Now only," no auction involved): price can move
//     up or down, and shipping is fully editable, any time before it sells
//     — "a regular person selling it," no auction mechanics to protect.
//   - Auction, no bids yet: starting bid and Buy It Now price can only be
//     LOWERED (never raised) or, for Buy It Now, removed entirely — eBay's
//     revise function is decrease-only for exactly the same reason (a buyer
//     who's seen the listing shouldn't have the price quietly raised on
//     them). Shipping is still editable. A Buy It Now price CAN be added
//     fresh even if none existed, same as eBay's "add Buy It Now" upgrade.
//   - Auction, one or more bids: nothing here is editable at all. Real
//     eBay locks price and shipping the instant a bid lands — Update
//     rejects with ErrHasBids before looking at any field, matching Cancel's
//     own bid guard. (PlaceBid also clears buy_it_now_price_cents itself
//     the moment a bid lands, mirroring eBay's Buy It Now actually
//     disappearing from a non-reserve auction the instant bidding starts —
//     so by the time Update would run, there's rarely even a BIN left to
//     protect.)
//
// Photos (ImageUrls) and the identity fields below (Title/SetName/
// CardNumber/Rarity) all follow the exact same editable/locked split as
// price and shipping — added, changed, or reordered freely right up until
// the same moment everything else locks (a bid landing), never singled out
// with a separate rule. Every real photo change is recorded to
// listing_photo_edits (see recordPhotoEdit) before/after, specifically so a
// "the seller swapped the photos at the last second" dispute claim can be
// checked against a real log instead of taken on faith — identity-field
// edits (title/set/card number/rarity) aren't separately logged the same
// way; only the photos ever carried that specific "was this switched at
// the last second" fraud concern.
type UpdateInput struct {
	// Title/SetName/CardNumber/Rarity mirror CreateInput's own fields
	// exactly (same JSON keys, same "empty string means unset" convention
	// for the optional three) — Title is required and trimmed the same way
	// Create requires it; SetName/CardNumber/Rarity may be blank.
	Title      string `json:"title"`
	SetName    string `json:"set"`
	CardNumber string `json:"cardNumber"`
	Rarity     string `json:"rarity"`
	// StartingBidCents only applies to an auction with no bids yet — must
	// be positive and <= the current starting bid (lower or equal, never
	// higher). Zero/omitted means "leave the starting bid as-is."
	StartingBidCents int64 `json:"startingBidCents"`
	// PriceCents is the Buy It Now price: a fixed-format listing's own
	// asking price (required, >0, any direction), or a pre-bid auction's
	// optional add-on (0 means "no Buy It Now" / removes an existing one;
	// a positive value must be <= any existing Buy It Now price, or any
	// positive amount if none existed yet).
	PriceCents     int64  `json:"priceCents"`
	AllowOffers    bool   `json:"allowOffers"`
	MinOfferCents  int64  `json:"minOfferCents"`
	ShippingPreset string `json:"shippingPreset"`
	// ImageUrls is the full, authoritative photo list in its final order
	// (not a delta) — same "client sends the whole current state" shape as
	// Create's own ImageUrls. Must be non-empty: a listing can't be edited
	// down to zero photos, same floor Create enforces at creation time.
	ImageUrls []string `json:"imageUrls"`
}

// Update applies the Selling page's Edit Listing form — see UpdateInput's
// own doc comment for exactly what's allowed and why. shippoClient mirrors
// Create's own use of it: only consulted when the (possibly newly-picked)
// preset is shippo_ground_advantage, to refresh the live rate estimate: a
// preset switch that leaves an old preset's stale estimate sitting on a
// shippo_ground_advantage listing would be exactly the kind of fabricated-
// looking number this codebase avoids elsewhere. A quote failure is never
// fatal — same graceful-degradation posture as Create.
func Update(ctx context.Context, pool *pgxpool.Pool, id, sellerID string, in UpdateInput, shippoClient *shipping.Client) (*Listing, error) {
	lst, err := Get(ctx, pool, id)
	if err != nil {
		return nil, err
	}
	if lst.SellerID != sellerID {
		return nil, ErrNotOwner
	}
	if lst.Status != "active" {
		return nil, ErrNotActive
	}
	// Real eBay: once an auction has a bid, revise is blocked outright —
	// not "some fields," all of them. Checked before any field-level
	// validation below, so a bid always wins over anything the client sent.
	if lst.Format == FormatAuction && lst.BidCount != nil && *lst.BidCount > 0 {
		return nil, ErrHasBids
	}

	if strings.TrimSpace(in.Title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if len(in.ImageUrls) == 0 {
		return nil, fmt.Errorf("%w: at least one photo is required", ErrInvalidInput)
	}
	// Order-sensitive on purpose — a pure reorder (same URLs, new order) is
	// still a real edit worth logging, not just an add/remove.
	photosChanged := !stringSlicesEqual(lst.ImageUrls, in.ImageUrls)

	shippingPresetStr := in.ShippingPreset
	if shippingPresetStr == "" {
		shippingPresetStr = string(lst.ShippingPreset)
	}
	preset := shipping.Preset(shippingPresetStr)
	if !preset.Valid() {
		return nil, fmt.Errorf("%w: shippingPreset must be one of the 5 valid presets", ErrInvalidInput)
	}

	var startingBidCents int64
	var binPriceCents int64

	if lst.Format == FormatFixed {
		if in.PriceCents <= 0 {
			return nil, fmt.Errorf("%w: priceCents must be positive", ErrInvalidInput)
		}
		binPriceCents = in.PriceCents
		// Same $100+ free-envelope/tracked-envelope guard Create enforces
		// — a fixed listing's final price is already known, unlike an
		// auction's, so this is checkable here the same way.
		if preset.Mechanism() == shipping.MechanismLetter && binPriceCents >= shipping.PackageRequiredCents {
			if preset.IsFree() {
				return nil, fmt.Errorf("%w: free envelope shipping isn't available on listings priced at $100 or more — pick free bubble mailer, free box, or a paid preset", ErrInvalidInput)
			}
			return nil, fmt.Errorf("%w: tracked envelope shipping isn't available on listings priced at $100 or more", ErrInvalidInput)
		}
	} else {
		// Auction, guaranteed zero bids past the ErrHasBids check above.
		if lst.StartingBidCents != nil {
			startingBidCents = *lst.StartingBidCents
		}
		if in.StartingBidCents != 0 {
			if in.StartingBidCents <= 0 {
				return nil, fmt.Errorf("%w: startingBidCents must be positive", ErrInvalidInput)
			}
			if in.StartingBidCents > startingBidCents {
				return nil, fmt.Errorf("%w: the starting bid can only be lowered, never raised, once a listing is live", ErrInvalidInput)
			}
			startingBidCents = in.StartingBidCents
		}

		existingBin := int64(0)
		if lst.BuyItNowPriceCents != nil {
			existingBin = *lst.BuyItNowPriceCents
		}
		if in.PriceCents > 0 {
			if existingBin > 0 && in.PriceCents > existingBin {
				return nil, fmt.Errorf("%w: a Buy It Now price can only be lowered, never raised, once a listing is live", ErrInvalidInput)
			}
			if in.PriceCents <= startingBidCents {
				return nil, fmt.Errorf("%w: buyItNowPriceCents must be greater than the starting bid", ErrInvalidInput)
			}
			binPriceCents = in.PriceCents
		}
		// in.PriceCents == 0 means "no Buy It Now" — either it's being
		// removed (existingBin was > 0) or there never was one; both leave
		// binPriceCents at its zero value, exactly like Create's own
		// "0 means unset" convention.
	}

	// Same listing-time signature-request heuristic as Create — recomputed
	// fresh from whatever price is in effect after this edit (never just
	// carried over from lst.RequestSignature), so raising a Buy It Now
	// price past the threshold on an edit locks it on immediately, exactly
	// like a fresh listing would.
	referencePriceCents := binPriceCents
	if referencePriceCents < startingBidCents {
		referencePriceCents = startingBidCents
	}
	requestSignature := shipping.RequestSignatureFromPrice(referencePriceCents)

	if in.AllowOffers {
		if binPriceCents <= 0 {
			return nil, fmt.Errorf("%w: allowOffers requires a Buy It Now price", ErrInvalidInput)
		}
		if in.MinOfferCents != 0 {
			if in.MinOfferCents <= 0 {
				return nil, fmt.Errorf("%w: minOfferCents must be positive", ErrInvalidInput)
			}
			if in.MinOfferCents >= binPriceCents {
				return nil, fmt.Errorf("%w: minOfferCents must be less than the Buy It Now price", ErrInvalidInput)
			}
		}
	} else if in.MinOfferCents != 0 {
		return nil, fmt.Errorf("%w: minOfferCents only applies when allowOffers is true", ErrInvalidInput)
	}

	var minOfferPtr *int64
	if in.AllowOffers && in.MinOfferCents > 0 {
		minOfferPtr = &in.MinOfferCents
	}

	// Same "quote before opening a transaction" reasoning as Create — a
	// live Shippo HTTP call has no business holding a DB transaction open.
	var estimatedShippingCents *int64
	if preset == shipping.PresetShippoGroundAdvantage && shippoClient.IsConfigured() {
		if sellerAddr, err := address.Get(ctx, pool, sellerID); err == nil {
			if sellerUser, err := user.Get(ctx, pool, sellerID); err == nil {
				if cents, err := shippoClient.QuoteRate(ctx, sellerAddr, shipping.ReferenceAddress, sellerUser.Email, sellerUser.Email, preset, requestSignature); err == nil {
					estimatedShippingCents = &cents
				}
			}
		}
	}

	// Always a transaction now, even on the fixed-price path — a photo
	// change and its audit-log row (below) have to commit together, or a
	// crash between the two would leave the log lying about what actually
	// happened.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	if lst.Format == FormatFixed {
		if _, err := tx.Exec(ctx, `
			update listings
			set title = $1, set_name = $2, card_number = nullif($3, ''), rarity = nullif($4, ''),
				price_cents = $5, allow_offers = $6, min_offer_cents = $7,
				shipping_preset = $8, estimated_shipping_cents = $9, request_signature = $10, image_urls = $11
			where id = $12
		`, in.Title, in.SetName, in.CardNumber, in.Rarity, in.PriceCents, in.AllowOffers, minOfferPtr,
			shippingPresetStr, estimatedShippingCents, requestSignature, in.ImageUrls, id); err != nil {
			return nil, fmt.Errorf("update listing: %w", err)
		}
	} else {
		var binPtr *int64
		if binPriceCents > 0 {
			binPtr = &binPriceCents
		}
		if _, err := tx.Exec(ctx, `
			update listings
			set title = $1, set_name = $2, card_number = nullif($3, ''), rarity = nullif($4, ''),
				allow_offers = $5, min_offer_cents = $6, shipping_preset = $7, estimated_shipping_cents = $8,
				request_signature = $9, image_urls = $10
			where id = $11
		`, in.Title, in.SetName, in.CardNumber, in.Rarity, in.AllowOffers, minOfferPtr,
			shippingPresetStr, estimatedShippingCents, requestSignature, in.ImageUrls, id); err != nil {
			return nil, fmt.Errorf("update listing: %w", err)
		}
		// current_price_cents tracks starting_bid_cents whenever there are
		// still zero bids (Create seeds them equal; nothing since then
		// would have moved current_price_cents on its own) — lowering the
		// starting bid has to move both together, or "Current bid" would
		// keep showing the old, higher starting price.
		if _, err := tx.Exec(ctx, `
			update auctions
			set starting_bid_cents = $1, current_price_cents = $1, buy_it_now_price_cents = $2
			where listing_id = $3
		`, startingBidCents, binPtr, id); err != nil {
			return nil, fmt.Errorf("update auction: %w", err)
		}
	}

	if photosChanged {
		if err := recordPhotoEdit(ctx, tx, id, sellerID, lst.ImageUrls, in.ImageUrls); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return Get(ctx, pool, id)
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
