package seller

import (
	"testing"
	"time"
)

func days(n int) time.Time {
	return time.Now().Add(-time.Duration(n) * 24 * time.Hour)
}

// goodReviewCount/goodAverageRating are a passing review record — high
// enough to clear even Haus Trust's bar (the strictest), since the gate is
// now scaled per target tier and a test's candidate promotion might jump
// straight to any tier depending on order count. Every test below that
// expects a promotion to actually succeed, or that means to isolate some
// other gate as the one doing the blocking, sets reviewCount/averageRating
// to these so the review gate itself never becomes an accidental second
// blocker, regardless of which tier it's actually being evaluated against.
const (
	goodReviewCount   = 150
	goodAverageRating = 4.9
)

func TestDecideTier_StaysNewBelowGraduationGuarantee(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 5,
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\")", tier, reason)
	}
}

func TestDecideTier_VolumePromotion(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 15, // exactly Bronze's threshold, §3.1
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierBronze || reason != "volume_promotion" {
		t.Errorf("got (%v, %q), want (Bronze, volume_promotion)", tier, reason)
	}
}

func TestDecideTier_PromotionJumpsStraightToHighestQualifyingTier(t *testing.T) {
	// The worker was down a while — 200 orders accumulated in one gap.
	// Promotion (unlike demotion) is allowed to skip straight to Gold.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(400),
		cumulativeOrders: 200,
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierGold || reason != "volume_promotion" {
		t.Errorf("got (%v, %q), want (Gold, volume_promotion)", tier, reason)
	}
}

func TestDecideTier_GraduationGuaranteeByOrderCount(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 25, // graduationOrderCount, but below Bronze's own 15-order threshold this wouldn't matter — 15 already promotes on its own
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierBronze || reason != "volume_promotion" {
		// 25 orders already clears the plain 15-order Bronze threshold on
		// its own, so this is volume_promotion, not the graduation
		// guarantee specifically — see the next test for when the
		// guarantee is what actually does the work.
		t.Errorf("got (%v, %q), want (Bronze, volume_promotion)", tier, reason)
	}
}

func TestDecideTier_GraduationGuaranteeByAge(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(31), // past the 30-day graduation window
		cumulativeOrders: 3,        // nowhere near 15, the plain Bronze threshold
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierBronze || reason != "graduation_guarantee" {
		t.Errorf("got (%v, %q), want (Bronze, graduation_guarantee)", tier, reason)
	}
}

func TestDecideTier_GraduationGuaranteeBlockedByAccountAgeGate(t *testing.T) {
	// 25 orders (graduation order count) but the account itself is only 5
	// days old — the account-age gate (§3.3) still applies to the
	// graduation guarantee, it isn't a bypass of the gates.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(5),
		cumulativeOrders: 25,
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — account-age gate should block this", tier, reason)
	}
}

func TestDecideTier_PromotionBlockedByDisputeRateGate(t *testing.T) {
	s := standing{
		currentTier:      TierGold,
		accountCreatedAt: days(400),
		cumulativeOrders: 600,  // qualifies for Haus Trust on volume alone
		disputeRate90d:   0.03, // over the 2% promotion gate, under the 4% demotion trigger
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierGold || reason != "" {
		t.Errorf("got (%v, %q), want (Gold, \"\") — dispute-rate gate should block promotion without triggering demotion", tier, reason)
	}
}

func TestDecideTier_DemotionDropsExactlyOneTier(t *testing.T) {
	s := standing{
		currentTier:      TierGold,
		accountCreatedAt: days(400),
		cumulativeOrders: 600, // would otherwise qualify for Platinum — demotion wins anyway
		disputeRate90d:   0.05,
	}
	tier, reason := decideTier(s)
	if tier != TierSilver || reason != "dispute_demotion" {
		t.Errorf("got (%v, %q), want (Silver, dispute_demotion) — exactly one tier down from Gold", tier, reason)
	}
}

func TestDecideTier_DemotionFromHausTrustDropsToPlatinum(t *testing.T) {
	// Haus Trust is application-only to get INTO, but demotion out of it
	// still steps down through the same tierOrder as every other tier —
	// one step, landing on Platinum, never straight to New.
	s := standing{
		currentTier:      TierHausTrust,
		accountCreatedAt: days(1000),
		cumulativeOrders: 1000,
		disputeRate90d:   0.06,
	}
	tier, reason := decideTier(s)
	if tier != TierPlatinum || reason != "dispute_demotion" {
		t.Errorf("got (%v, %q), want (Platinum, dispute_demotion) — exactly one tier down from Haus Trust", tier, reason)
	}
}

func TestDecideTier_VolumePromotionToPlatinum(t *testing.T) {
	s := standing{
		currentTier:      TierGold,
		accountCreatedAt: days(400),
		cumulativeOrders: 600, // clears Platinum's 500-order threshold
		reviewCount:      goodReviewCount,
		averageRating:    goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierPlatinum || reason != "volume_promotion" {
		t.Errorf("got (%v, %q), want (Platinum, volume_promotion)", tier, reason)
	}
}

func TestDecideTier_DemotionLockout(t *testing.T) {
	recent := days(10) // within the 30-day repromotion/redemotion lockout
	s := standing{
		currentTier:      TierGold,
		accountCreatedAt: days(400),
		cumulativeOrders: 200,
		disputeRate90d:   0.05,
		lastDemotionAt:   &recent,
	}
	tier, reason := decideTier(s)
	if tier != TierGold || reason != "" {
		t.Errorf("got (%v, %q), want (Gold, \"\") — locked out from a second demotion within 30 days", tier, reason)
	}
}

func TestDecideTier_CannotDemoteBelowNew(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(400),
		cumulativeOrders: 0,
		disputeRate90d:   0.10,
	}
	tier, _ := decideTier(s)
	if tier != TierNew {
		t.Errorf("got %v, want New — there is no tier below New to demote to", tier)
	}
}

func TestDecideTier_OpenClaimBlocksPromotion(t *testing.T) {
	oldClaim := 10 * 24 * time.Hour // older than the 7-day gate
	s := standing{
		currentTier:        TierNew,
		accountCreatedAt:   days(20),
		cumulativeOrders:   15,
		oldestOpenClaimAge: &oldClaim,
		reviewCount:        goodReviewCount,
		averageRating:      goodAverageRating,
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — an unresolved claim older than 7 days should block promotion", tier, reason)
	}
}

func TestDecideTier_PromotionBlockedByLowAverageRating(t *testing.T) {
	// Plenty of sales, plenty of reviews, but the reviews themselves are
	// bad — this is the exact scenario the gate exists for: volume alone
	// must not be enough.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 15,
		reviewCount:      20,
		averageRating:    3.2, // below Bronze's floor, minAverageRatingForTier[TierBronze] (4.0)
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — a poor average rating should block promotion even with plenty of sales and reviews", tier, reason)
	}
}

func TestDecideTier_PromotionBlockedByTooFewReviews(t *testing.T) {
	// A good average, but it's an average of essentially nothing — one
	// glowing review shouldn't be enough to certify a seller's standing.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 15,
		reviewCount:      1, // below Bronze's floor, minReviewsForTier[TierBronze] (5)
		averageRating:    5.0,
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — too few reviews to trust the average should block promotion", tier, reason)
	}
}

func TestDecideTier_GraduationGuaranteeBlockedByReviewGate(t *testing.T) {
	// The graduation guarantee (§3.4) is not a bypass of the review gate
	// any more than it's a bypass of the account-age gate — a new seller
	// hitting 30 days with a bad review record still doesn't graduate.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(31),
		cumulativeOrders: 3,
		reviewCount:      5,
		averageRating:    2.5,
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — the graduation guarantee should not override a poor review record", tier, reason)
	}
}

func TestDecideTier_PromotionAllowedWithGoodReviews(t *testing.T) {
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(20),
		cumulativeOrders: 15,
		reviewCount:      minReviewsForTier[TierBronze],       // exactly Bronze's floor
		averageRating:    minAverageRatingForTier[TierBronze], // exactly Bronze's floor
	}
	tier, reason := decideTier(s)
	if tier != TierBronze || reason != "volume_promotion" {
		t.Errorf("got (%v, %q), want (Bronze, volume_promotion) — meeting the review gate exactly at its floor should still pass", tier, reason)
	}
}

func TestDecideTier_ReviewGateScalesWithTargetTier(t *testing.T) {
	// Clears Bronze's review bar comfortably, but not Gold's — a seller
	// whose order count alone would jump them straight to Gold has to meet
	// GOLD's bar, not settle for Bronze's easier one just because they'd
	// have cleared that.
	s := standing{
		currentTier:      TierNew,
		accountCreatedAt: days(400),
		cumulativeOrders: 200, // qualifies for Gold on volume alone
		reviewCount:      10,  // clears Bronze's floor (5), not Gold's (40)
		averageRating:    4.2, // clears Bronze's floor (4.0), not Gold's (4.5)
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — Gold's stricter review bar should block a jump-to-Gold promotion even though Bronze's bar would've passed", tier, reason)
	}
}

func TestTierForOrders(t *testing.T) {
	cases := []struct {
		orders int
		want   Tier
	}{
		{0, TierNew},
		{14, TierNew},
		{15, TierBronze},
		{49, TierBronze},
		{50, TierSilver},
		{149, TierSilver},
		{150, TierGold},
		{499, TierGold},
		{500, TierPlatinum},
		// Order volume alone never reaches Haus Trust, no matter how high —
		// it's application-only (see volumeTierOrder's doc comment).
		{10000, TierPlatinum},
	}
	for _, c := range cases {
		if got := tierForOrders(c.orders); got != c.want {
			t.Errorf("tierForOrders(%d) = %v, want %v", c.orders, got, c.want)
		}
	}
}

func TestTierForOrders_NeverReturnsHausTrust(t *testing.T) {
	// Explicit regression test for the exact bug volumeTierOrder exists to
	// prevent: TierHausTrust has no entry in tierThreshold, so a naive
	// implementation using the full tierOrder would treat its threshold as
	// 0 and award it to literally every seller.
	for _, n := range []int{0, 1, 500, 1000, 1000000} {
		if got := tierForOrders(n); got == TierHausTrust {
			t.Errorf("tierForOrders(%d) = Haus Trust — volume alone must never reach it", n)
		}
	}
}
