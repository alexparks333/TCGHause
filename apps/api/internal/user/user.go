// Package user owns the public-facing identity concept shown wherever a
// seller/buyer is displayed to someone else — a chosen username, not their
// email (CLAUDE.md's account-creation section covers the auth pipeline
// this builds on). email stays real and returned by Get/HandleMe; it's
// just no longer shown to other users anywhere in the frontend.
package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

var (
	ErrNotFound        = errors.New("user not found")
	ErrInvalidUsername = errors.New("username must be 3-20 characters, letters/numbers/underscore only")
	ErrUsernameTaken   = errors.New("username is already taken")
	ErrNoUsername      = errors.New("you must set a username before doing this")
	ErrInvalidBio      = errors.New("bio must be 500 characters or fewer")
	ErrInvalidStickers = errors.New("invalid sticker placement")
	ErrTooManyStickers = fmt.Errorf("no more than %d stickers allowed", maxStickers)
	ErrInvalidWidgets  = errors.New("invalid widget layout")
	ErrTooManyWidgets  = fmt.Errorf("no more than %d widgets allowed", maxWidgets)
	ErrInvalidCanvas   = errors.New("invalid profile canvas")
)

const maxBioLength = 500

// The sticker art available today is exactly the tier badges already
// commissioned (lib/types.ts's sellerTierIconSrc) — "new" and "platinum"
// have no art yet, so they're not offered as stickers either.
var validStickerKinds = map[string]bool{
	"bronze":     true,
	"silver":     true,
	"gold":       true,
	"hous_trust": true,
}

const maxStickers = 12

// Sanity bound on YPx, not a real design constraint — a seller with a huge
// widget stack has a tall canvas, and stickers should be placeable
// anywhere in it. This just rejects garbage input.
const maxStickerYPx = 20000

// ProfileSticker is one tier-icon sticker a seller has dragged onto their
// profile canvas. XPct is a percentage (0-100) of the canvas's own width —
// width is stable, driven by viewport/layout, so a percentage still lines
// up correctly between the editor and the public profile page regardless
// of either one's actual rendered width. YPx is deliberately NOT a
// percentage — it's pixels down from the canvas's top edge. The canvas's
// *height* is driven entirely by its content (the widget stack below the
// fixed header), which grows or shrinks every time a widget is added or
// removed; a percentage-of-height Y coordinate would recompute to a
// different pixel position every time that total height changed, which is
// exactly the bug this fixed — adding a widget (or even just toggling
// the editor's own per-widget toolbar chrome) was dragging every sticker
// up or down even though nothing about the sticker itself changed. Pixels
// from the top means the canvas can only ever grow/shrink from the
// bottom as widgets come and go; whatever's already anchored near the top
// never moves. RotationDeg/Scale aren't editable yet (no rotate/resize
// handles in the UI) but are shipped now so a future editor upgrade is an
// additive change, not another migration — see CLAUDE.md's profile-canvas
// plan.
type ProfileSticker struct {
	ID          string  `json:"id"`
	Kind        string  `json:"kind"`
	XPct        float64 `json:"xPct"`
	YPx         float64 `json:"yPx"`
	RotationDeg float64 `json:"rotationDeg"`
	Scale       float64 `json:"scale"`
}

// The widget types the profile canvas supports today — CLAUDE.md's
// profile-canvas plan calls out that more (a Steam-style "Showcase",
// achievements/badges, etc.) are meant to land as additional catalog
// entries later, not a rewrite. Any type can be placed more than once
// (see SetWidgets) — maxWidgets below is the only ceiling.
var validWidgetTypes = map[string]bool{
	"listings":      true,
	"favorite_card": true,
	"empty_space":   true,
}

const maxWidgets = 6

// ProfileWidget is one content block a seller has added to their profile
// canvas — Type selects the renderer (frontend's WIDGET_CATALOG). The
// canvas is a 3-column grid: order is the widget's index in the stored
// slice, which decides which ROW it flows into (a widget spanning all 3
// columns, like "listings", always starts a fresh row; a 1-column widget
// shares a row with whatever else fits), but not which column — Col is
// what pins that explicitly (0, 1, or 2), so a 1-column widget can be
// dropped into any of the 3 slots on its row rather than always landing
// in the first free one. Meaningless for a full-width type, which always
// starts at column 0 regardless of what's stored here — the frontend
// simply never reads it for those. FavoriteCard is only meaningful for
// "favorite_card" — nil means "added but not configured yet", not an
// error.
type ProfileWidget struct {
	ID           string           `json:"id"`
	Type         string           `json:"type"`
	Col          int              `json:"col"`
	FavoriteCard *FavoriteCardRef `json:"favoriteCard"`
}

// FavoriteCardRef is a denormalized snapshot of one internal/cardcatalog.Card
// result, picked from the widget picker's "search all cards" box
// (cardcatalog.SearchAll) rather than referencing one of the seller's own
// listings the way this widget originally worked. It's a snapshot, not a
// foreign key, deliberately: internal/cardcatalog has no "get by id"
// lookup (only Search/SearchAll), so there's nothing to re-fetch or
// re-validate ownership of — anyone can feature any catalog card, the same
// way anyone can type any card name into the Sell wizard's search box.
type FavoriteCardRef struct {
	ID       string `json:"id"`
	Game     string `json:"game"`
	Name     string `json:"name"`
	SetName  string `json:"setName"`
	Number   string `json:"number"`
	Rarity   string `json:"rarity"`
	ImageURL string `json:"imageUrl"`
}

// maxFavoriteCardFieldLength bounds every FavoriteCardRef string field —
// generous enough for any real catalog value, just a sanity cap against a
// client sending garbage into a jsonb column with no other size limit.
const maxFavoriteCardFieldLength = 500

// Bitmap-size sanity bounds for the painted profile canvas. Width is the
// client's fixed PAINT_DESIGN_WIDTH constant (1440 today) with headroom for
// a future bump; height mirrors maxStickerYPx — both describe the same
// content-driven canvas, so they should agree on how tall it can get.
const (
	maxCanvasWidthPx  = 4000
	maxCanvasHeightPx = 20000
)

// ProfileCanvas describes the seller's freehand painting layer — a pointer
// to a lossless PNG in the profile-canvas Storage bucket plus the bitmap's
// intrinsic pixel size. The pixels themselves never touch Postgres; this is
// only the descriptor, fully replaced on every save like Stickers/Widgets.
// Width is the fixed design width the client painted at; Height grows as
// widgets extend the page (new pixel rows, never a rescale — see the
// frontend's paint/constants.ts).
type ProfileCanvas struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// User is both the domain model and the /me JSON shape — includes Email,
// which is why this type must never be serialized directly from a public
// (non-"me") endpoint. Username and Bio are nullable — a fresh Google
// OAuth sign-in has no username until they complete the claim-username
// flow (apps/api/migrations/0008_usernames.up.sql), and a bio is optional.
type User struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Username  *string `json:"username"`
	Bio       *string `json:"bio"`
	CreatedAt string  `json:"createdAt"`
	// Tier is design doc v2 §3's trust tier (internal/seller.Tier) —
	// 'new' for every seller until they've completed enough orders to
	// promote (internal/seller.RecomputeTier). Included on the plain User
	// shape, not gated behind a separate seller-only endpoint, since a
	// tier badge is meant to be publicly visible on a seller's profile
	// (design doc v2 §2.7: "publish the full tier ladder openly").
	Tier string `json:"tier"`
	// Stickers is the seller's own profile-canvas background arrangement —
	// see ProfileSticker. Always a non-nil slice (possibly empty), never
	// omitted, so the frontend never has to special-case "null" vs "[]".
	Stickers []ProfileSticker `json:"stickers"`
	// Widgets is the seller's own profile-canvas layout — see
	// ProfileWidget. Same non-nil-slice guarantee as Stickers. An empty
	// slice means "never customized" and the frontend falls back to the
	// default layout (just the Listings widget), not an empty page.
	Widgets []ProfileWidget `json:"widgets"`
	// ProfileCanvas is the seller's painted background artwork — nil means
	// "never painted", which is a real, distinct state (no paint layer
	// rendered at all), unlike Stickers/Widgets' always-non-nil slices.
	ProfileCanvas *ProfileCanvas `json:"profileCanvas"`
}

// PublicUser is what a seller's public profile page shows other users —
// deliberately excludes Email, the entire point of the username feature
// this builds on. Tier, Stickers, and Widgets are intentionally still
// included — see User.Tier; a customized canvas only means something once
// other people can see it.
type PublicUser struct {
	ID            string           `json:"id"`
	Username      *string          `json:"username"`
	Bio           *string          `json:"bio"`
	CreatedAt     string           `json:"createdAt"`
	Tier          string           `json:"tier"`
	Stickers      []ProfileSticker `json:"stickers"`
	Widgets       []ProfileWidget  `json:"widgets"`
	ProfileCanvas *ProfileCanvas   `json:"profileCanvas"`
}

func (u *User) ToPublic() *PublicUser {
	return &PublicUser{
		ID: u.ID, Username: u.Username, Bio: u.Bio, CreatedAt: u.CreatedAt, Tier: u.Tier,
		Stickers: u.Stickers, Widgets: u.Widgets, ProfileCanvas: u.ProfileCanvas,
	}
}

func Get(ctx context.Context, pool *pgxpool.Pool, id string) (*User, error) {
	var u User
	var createdAt time.Time
	var stickersRaw, widgetsRaw, canvasRaw []byte
	err := pool.QueryRow(ctx,
		`select id, email, username, bio, created_at, tier, profile_stickers, profile_widgets, profile_canvas from users where id = $1`, id,
	).Scan(&u.ID, &u.Email, &u.Username, &u.Bio, &createdAt, &u.Tier, &stickersRaw, &widgetsRaw, &canvasRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query user: %w", err)
	}
	u.CreatedAt = createdAt.Format(time.RFC3339)
	if err := unmarshalJSONColumn(stickersRaw, &u.Stickers, "profile stickers"); err != nil {
		return nil, err
	}
	if err := unmarshalJSONColumn(widgetsRaw, &u.Widgets, "profile widgets"); err != nil {
		return nil, err
	}
	if err := unmarshalCanvasColumn(canvasRaw, &u.ProfileCanvas); err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByUsername resolves a public username to the full user row — used
// both to render a seller's public profile (via ToPublic) and internally
// by internal/feedback to resolve a seller's id from the username in a
// review endpoint's URL.
func GetByUsername(ctx context.Context, pool *pgxpool.Pool, username string) (*User, error) {
	var u User
	var createdAt time.Time
	var stickersRaw, widgetsRaw, canvasRaw []byte
	err := pool.QueryRow(ctx,
		`select id, email, username, bio, created_at, tier, profile_stickers, profile_widgets, profile_canvas from users where lower(username) = lower($1)`, username,
	).Scan(&u.ID, &u.Email, &u.Username, &u.Bio, &createdAt, &u.Tier, &stickersRaw, &widgetsRaw, &canvasRaw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query user by username: %w", err)
	}
	u.CreatedAt = createdAt.Format(time.RFC3339)
	if err := unmarshalJSONColumn(stickersRaw, &u.Stickers, "profile stickers"); err != nil {
		return nil, err
	}
	if err := unmarshalJSONColumn(widgetsRaw, &u.Widgets, "profile widgets"); err != nil {
		return nil, err
	}
	if err := unmarshalCanvasColumn(canvasRaw, &u.ProfileCanvas); err != nil {
		return nil, err
	}
	return &u, nil
}

// unmarshalCanvasColumn is the nullable-single-object cousin of
// unmarshalJSONColumn — profile_canvas is a nullable jsonb (null = never
// painted), so a nil/empty raw value leaves the pointer nil rather than
// erroring or fabricating a zero-value canvas.
func unmarshalCanvasColumn(raw []byte, out **ProfileCanvas) error {
	if len(raw) == 0 || string(raw) == "null" {
		*out = nil
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode profile canvas: %w", err)
	}
	return nil
}

// unmarshalJSONColumn turns a raw jsonb column into a non-nil slice —
// json.Unmarshal leaves a nil slice for "[]", which is already what we
// want, but this makes the "always non-nil" guarantee explicit rather
// than relying on that incidental behavior. Shared by Stickers and
// Widgets since both are structurally identical: an array column that's
// always fully replaced on write, never patched.
func unmarshalJSONColumn[T any](raw []byte, out *[]T, label string) error {
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode %s: %w", label, err)
	}
	if *out == nil {
		*out = []T{}
	}
	return nil
}

// ValidateUsername is the single source of truth for the format rule on
// the Go side — SetUsername and IsUsernameAvailable both call this so the
// two never drift from each other or from the DB's own check constraint.
func ValidateUsername(username string) error {
	if !usernameRe.MatchString(username) {
		return ErrInvalidUsername
	}
	return nil
}

// SetUsername claims or changes userID's username — the same call backs
// both the first-time claim flow and later edits from Account Settings,
// since the semantics (validate, attempt update, 409 on collision) don't
// differ by which screen called it. ErrUsernameTaken is the
// defense-in-depth path for when IsUsernameAvailable's earlier check has
// gone stale by submit time (another user claimed it in between).
func SetUsername(ctx context.Context, pool *pgxpool.Pool, userID, username string) (*User, error) {
	if err := ValidateUsername(username); err != nil {
		return nil, err
	}
	_, err := pool.Exec(ctx, `update users set username = $1 where id = $2`, username, userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrUsernameTaken
		}
		return nil, fmt.Errorf("update username: %w", err)
	}
	return Get(ctx, pool, userID)
}

// IsUsernameAvailable backs the public GET /usernames/available endpoint.
// Format-invalid input reports as unavailable rather than a separate
// error, so the frontend's debounce hook only ever needs one boolean.
func IsUsernameAvailable(ctx context.Context, pool *pgxpool.Pool, username string) (bool, error) {
	if err := ValidateUsername(username); err != nil {
		return false, nil
	}
	var exists bool
	err := pool.QueryRow(ctx,
		`select exists(select 1 from users where lower(username) = lower($1))`, username,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check username availability: %w", err)
	}
	return !exists, nil
}

// SetBio updates userID's bio. An empty string clears it (stored as NULL,
// not ""), so the profile page can tell "no bio written" apart from
// "wrote an empty string" without a separate flag.
func SetBio(ctx context.Context, pool *pgxpool.Pool, userID, bio string) (*User, error) {
	if len(bio) > maxBioLength {
		return nil, ErrInvalidBio
	}
	var bioArg *string
	if bio != "" {
		bioArg = &bio
	}
	if _, err := pool.Exec(ctx, `update users set bio = $1 where id = $2`, bioArg, userID); err != nil {
		return nil, fmt.Errorf("update bio: %w", err)
	}
	return Get(ctx, pool, userID)
}

// SetStickers overwrites userID's whole profile-board arrangement — the
// client always sends the full set (see ProfileSticker's doc comment), so
// this is a replace, not an append/patch. Validates every sticker before
// writing any of them, so a bad entry never partially clobbers a
// previously-valid board.
func SetStickers(ctx context.Context, pool *pgxpool.Pool, userID string, stickers []ProfileSticker) (*User, error) {
	if len(stickers) > maxStickers {
		return nil, ErrTooManyStickers
	}
	for i, s := range stickers {
		if s.ID == "" || len(s.ID) > 64 {
			return nil, ErrInvalidStickers
		}
		if !validStickerKinds[s.Kind] {
			return nil, ErrInvalidStickers
		}
		if s.XPct < 0 || s.XPct > 100 {
			return nil, ErrInvalidStickers
		}
		if s.YPx < 0 || s.YPx > maxStickerYPx {
			return nil, ErrInvalidStickers
		}
		if s.RotationDeg < -180 || s.RotationDeg > 180 {
			return nil, ErrInvalidStickers
		}
		// No rotate/resize UI yet (see ProfileSticker's doc comment), so a
		// zero/omitted Scale from an older client just means "unset", not
		// "shrink to nothing" — default it rather than reject or store it
		// literally as 0.
		if s.Scale == 0 {
			stickers[i].Scale = 1
		} else if s.Scale < 0.4 || s.Scale > 2.5 {
			return nil, ErrInvalidStickers
		}
	}
	raw, err := json.Marshal(stickers)
	if err != nil {
		return nil, fmt.Errorf("encode profile stickers: %w", err)
	}
	// A []byte parameter would encode as a bytea hex literal under this
	// pool's QueryExecModeSimpleProtocol (internal/platform/db.go) —
	// invalid input for a jsonb column. Passing the JSON as a string keeps
	// it a plain text literal, which jsonb can parse directly.
	if _, err := pool.Exec(ctx, `update users set profile_stickers = $1 where id = $2`, string(raw), userID); err != nil {
		return nil, fmt.Errorf("update profile stickers: %w", err)
	}
	return Get(ctx, pool, userID)
}

// SetWidgets overwrites userID's whole profile-canvas layout — same
// replace-the-whole-set semantics as SetStickers.
func SetWidgets(ctx context.Context, pool *pgxpool.Pool, userID string, widgets []ProfileWidget) (*User, error) {
	if len(widgets) > maxWidgets {
		return nil, ErrTooManyWidgets
	}
	for _, w := range widgets {
		if w.ID == "" || len(w.ID) > 64 {
			return nil, ErrInvalidWidgets
		}
		if !validWidgetTypes[w.Type] {
			return nil, ErrInvalidWidgets
		}
		if w.Col < 0 || w.Col > 2 {
			return nil, ErrInvalidWidgets
		}
		// No per-type cap — a seller can place as many of any one type as
		// they want (three Favorite Cards, three Listings feeds, ...),
		// bounded only by maxWidgets above. This used to cap every
		// real-content type at one each ("there's only one 'your listings'
		// feed, one favorite-card slot") with "empty_space" as the sole
		// exemption — removed by explicit product decision, not just
		// relaxed for empty_space's sake anymore.
		if w.FavoriteCard != nil {
			f := w.FavoriteCard
			if f.ID == "" || f.Game == "" || f.Name == "" || f.ImageURL == "" {
				return nil, ErrInvalidWidgets
			}
			if len(f.ID) > maxFavoriteCardFieldLength || len(f.Game) > maxFavoriteCardFieldLength ||
				len(f.Name) > maxFavoriteCardFieldLength || len(f.SetName) > maxFavoriteCardFieldLength ||
				len(f.Number) > maxFavoriteCardFieldLength || len(f.Rarity) > maxFavoriteCardFieldLength ||
				len(f.ImageURL) > maxFavoriteCardFieldLength {
				return nil, ErrInvalidWidgets
			}
		}
	}
	raw, err := json.Marshal(widgets)
	if err != nil {
		return nil, fmt.Errorf("encode profile widgets: %w", err)
	}
	if _, err := pool.Exec(ctx, `update users set profile_widgets = $1 where id = $2`, string(raw), userID); err != nil {
		return nil, fmt.Errorf("update profile widgets: %w", err)
	}
	return Get(ctx, pool, userID)
}

// SetCanvas replaces userID's painted-canvas descriptor — same
// replace-the-whole-thing semantics as SetStickers/SetWidgets. A nil canvas
// clears the painting (stored as SQL null, the "never painted" state). The
// URL must point into the caller's own folder of the profile-canvas bucket:
// the descriptor is client-supplied, so without this check anyone could
// point their profile at an arbitrary external image or another user's
// artwork. http (not just https) is allowed for local Supabase dev.
func SetCanvas(ctx context.Context, pool *pgxpool.Pool, userID string, c *ProfileCanvas) (*User, error) {
	if c == nil {
		if _, err := pool.Exec(ctx, `update users set profile_canvas = null where id = $1`, userID); err != nil {
			return nil, fmt.Errorf("clear profile canvas: %w", err)
		}
		return Get(ctx, pool, userID)
	}
	if c.Width < 100 || c.Width > maxCanvasWidthPx {
		return nil, ErrInvalidCanvas
	}
	if c.Height < 1 || c.Height > maxCanvasHeightPx {
		return nil, ErrInvalidCanvas
	}
	parsed, err := url.Parse(c.URL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, ErrInvalidCanvas
	}
	if !strings.Contains(parsed.Path, "/storage/v1/object/public/profile-canvas/"+userID+"/") {
		return nil, ErrInvalidCanvas
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, fmt.Errorf("encode profile canvas: %w", err)
	}
	// string(raw), not raw: same QueryExecModeSimpleProtocol jsonb quirk as
	// SetStickers — a []byte parameter encodes as a bytea hex literal.
	if _, err := pool.Exec(ctx, `update users set profile_canvas = $1 where id = $2`, string(raw), userID); err != nil {
		return nil, fmt.Errorf("update profile canvas: %w", err)
	}
	return Get(ctx, pool, userID)
}

// RequireUsername is called by listing.Create to enforce "you must have a
// username before creating public-facing content" — the one place today
// that resolves a user's identity to a display string for other people to
// see (CLAUDE.md: bidder identity is never resolved to text, only an id).
func RequireUsername(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	u, err := Get(ctx, pool, userID)
	if err != nil {
		return err
	}
	if u.Username == nil {
		return ErrNoUsername
	}
	return nil
}

// IsAdmin checks callerID's email against a comma-separated allowlist
// (platform.Config.AdminEmails) — the minimal, no-real-admin-app stand-in
// shared by internal/dispute's human-review routes and internal/metrics'
// reporting page. Empty adminEmails means nobody is an admin, not that
// everybody is.
func IsAdmin(ctx context.Context, pool *pgxpool.Pool, adminEmails, callerID string) bool {
	if adminEmails == "" {
		return false
	}
	u, err := Get(ctx, pool, callerID)
	if err != nil {
		return false
	}
	for _, allowed := range strings.Split(adminEmails, ",") {
		if strings.EqualFold(strings.TrimSpace(allowed), u.Email) {
			return true
		}
	}
	return false
}
