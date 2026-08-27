package shipping

import "auctionhous-tcg/api/internal/address"

// ReferenceAddress is a fixed, representative "to" address used only for
// computing a listing's one-time shippo_ground_advantage cost estimate
// (internal/listing.Create) — there's no real buyer yet at listing time to
// quote a real rate against, so this stands in for "somewhere in the US."
// Never used for an actual shipment; BuyLabel always uses the real
// buyer's address once one exists.
var ReferenceAddress = &address.Address{
	FullName:   "Reference Buyer",
	Line1:      "1600 Pennsylvania Ave NW",
	City:       "Washington",
	State:      "DC",
	PostalCode: "20500",
	Country:    "US",
	Phone:      referenceAddressPhone(),
}

func referenceAddressPhone() *string {
	// Shippo requires a phone on every address it rate-shops, discovered
	// live the same way the email requirement was (shippo.go's doc
	// comment) — a placeholder is fine here since this address never
	// actually receives a shipment.
	p := "2025551234"
	return &p
}

// Preset is a seller's chosen shipping method at listing time — one of 5
// concrete options, each locked to exactly one fulfillment Mechanism, so a
// seller can never declare one shipping method on the listing and fulfill
// with another (a bubble mailer shipped under a "Tracked Envelope"
// preset, or vice versa). The listing shows this preset directly to
// buyers, per the product requirement that they know how an item will
// ship before they buy it.
type Preset string

const (
	// PresetFreeEnvelope / PresetFreeBubbleMailer / PresetFreeBox: the
	// seller absorbs the real shipping cost, the buyer pays $0 — but the
	// seller still declares which of the three physical packagings
	// they'll use, so the buyer isn't left guessing. All three are valid
	// on auctions too: free_bubble_mailer/free_box are already
	// package-mechanism, so a high final price just means the seller
	// absorbs a bigger bill — an ordinary consequence of offering free
	// shipping, not something to gate. free_envelope is the one that
	// needs care (see UpgradePreset) since its mechanism can need to
	// upgrade after the fact.
	PresetFreeEnvelope     Preset = "free_envelope"
	PresetFreeBubbleMailer Preset = "free_bubble_mailer"
	PresetFreeBox          Preset = "free_box"
	// PresetTrackedEnvelope: buyer pays a flat TrackedEnvelopeCents,
	// mechanism is always Pitney Bowes (IMb).
	PresetTrackedEnvelope Preset = "tracked_envelope"
	// PresetShippoGroundAdvantage: buyer pays whatever Shippo actually
	// quotes at checkout time (see internal/auction's quoteForListing) —
	// the listing shows only a one-time estimate, computed at creation
	// time, never the guaranteed final price.
	PresetShippoGroundAdvantage Preset = "shippo_ground_advantage"
)

func (p Preset) Valid() bool {
	switch p {
	case PresetFreeEnvelope, PresetFreeBubbleMailer, PresetFreeBox, PresetTrackedEnvelope, PresetShippoGroundAdvantage:
		return true
	}
	return false
}

// IsFree reports whether the buyer pays $0 shipping under this preset
// (the seller absorbs the real cost instead).
func (p Preset) IsFree() bool {
	switch p {
	case PresetFreeEnvelope, PresetFreeBubbleMailer, PresetFreeBox:
		return true
	}
	return false
}

// Mechanism is which vendor/fulfillment path a preset is locked to.
type Mechanism string

const (
	MechanismLetter  Mechanism = "letter"  // Pitney Bowes: tracked envelope, IMb
	MechanismPackage Mechanism = "package" // Shippo: tracked package
)

func (p Preset) Mechanism() Mechanism {
	switch p {
	case PresetFreeEnvelope, PresetTrackedEnvelope:
		return MechanismLetter
	default:
		return MechanismPackage
	}
}

// PackagingLabel is the physical packaging a buyer should expect to
// receive under this preset — shown on the listing itself.
func (p Preset) PackagingLabel() string {
	switch p {
	case PresetFreeEnvelope, PresetTrackedEnvelope:
		return "Envelope"
	case PresetFreeBubbleMailer, PresetShippoGroundAdvantage:
		return "Bubble Mailer"
	case PresetFreeBox:
		return "Box"
	}
	return ""
}

// TrackedEnvelopeCents is the flat buyer-facing price for the
// tracked_envelope preset — a product decision, not a live quote (unlike
// shippo_ground_advantage, Pitney Bowes' IMb letter cost doesn't vary by
// destination the way a package rate does). Set from real sandbox
// pricing: ~$1.19 non-machinable-rate postage (a semi-rigid card saver
// still counts as rigid enough to require it) + ~$0.32 Pitney Bowes IMb
// fee at sub-50/month volume, rounded up slightly. Revisit once real
// volume brings the per-piece fee down.
const TrackedEnvelopeCents = 151

// PackageRequiredCents / SignatureRequiredCents are the value-driven
// thresholds (product decision): $100 crosses into mandatory package
// mechanism — Pitney Bowes' envelope tracking is real but only proves
// transit through the postal system, not delivery, which isn't strong
// enough evidence once real money is at stake. $500 crosses into
// mandatory signature confirmation on top of that (a package-only
// concept — see order.CreateInput's doc comment on SignatureRequired).
const (
	PackageRequiredCents   = 10000
	SignatureRequiredCents = 50000
)

// RequiredMechanism derives the minimum mechanism an order's final charged
// amount mandates — the floor UpgradePreset enforces against whatever the
// seller chose at listing time.
func RequiredMechanism(amountCents int64) Mechanism {
	if amountCents >= PackageRequiredCents {
		return MechanismPackage
	}
	return MechanismLetter
}

// UpgradePreset resolves what an order actually ships as, given the
// seller's chosen listing-time preset and the final sale price. Only ever
// upgrades the mechanism (letter -> package), never loosens a seller's
// own stricter choice, and never turns a free preset into a paid one —
// that would silently start charging a buyer for shipping the seller
// promised was free, which is exactly the kind of bait-and-switch this
// whole mechanism-locking feature exists to prevent. A free_envelope
// auction that closes above $100 upgrades to free_bubble_mailer (still
// free to the buyer, the seller just absorbs a real package rate instead
// of envelope postage) rather than shippo_ground_advantage. A
// free_bubble_mailer/free_box order crossing $500 stays exactly as it is
// mechanism-wise — already package — just with signatureRequired now true.
func UpgradePreset(chosen Preset, finalAmountCents int64) (resolved Preset, signatureRequired bool) {
	resolved = chosen
	if RequiredMechanism(finalAmountCents) == MechanismPackage && chosen.Mechanism() == MechanismLetter {
		if chosen.IsFree() {
			resolved = PresetFreeBubbleMailer
		} else {
			resolved = PresetShippoGroundAdvantage
		}
	}
	signatureRequired = finalAmountCents >= SignatureRequiredCents
	return resolved, signatureRequired
}

// DefaultPackageEstimateCents is the fallback used by ChargedCents when a
// shippo_ground_advantage order has no listing-time estimate to fall back
// on (e.g. an order force-upgraded from tracked_envelope, which never had
// one) — set from real observed USPS Ground Advantage rates
// (docs/Shipping_Research.md), not a guess.
const DefaultPackageEstimateCents = 600

// ChargedCents is what the buyer is actually charged for shipping under a
// resolved preset (internal/auction's checkout-intent and order-creation
// code both call this so the authorized amount and the recorded order
// amount can never drift apart). Free presets are always 0 regardless of
// real cost — the seller absorbs that separately, outside what the buyer
// is charged. tracked_envelope is always the flat TrackedEnvelopeCents.
// shippo_ground_advantage uses the listing's one-time estimate
// (estimatedShippingCents) as the actual charge — not a fresh live quote
// against the real buyer address, which would need a Shippo call inside
// the checkout-intent authorization path; that's a documented follow-up,
// not built yet, so the estimate IS the charge for now.
func ChargedCents(preset Preset, estimatedShippingCents *int64) int64 {
	if preset.IsFree() {
		return 0
	}
	if preset == PresetTrackedEnvelope {
		return TrackedEnvelopeCents
	}
	if estimatedShippingCents != nil {
		return *estimatedShippingCents
	}
	return DefaultPackageEstimateCents
}
