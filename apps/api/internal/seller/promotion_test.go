package seller

import (
	"testing"
	"time"
)

func days(n int) time.Time {
	return time.Now().Add(-time.Duration(n) * 24 * time.Hour)
}

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
		cumulativeOrders: 600, // would otherwise qualify for Haus Trust — demotion wins anyway
		disputeRate90d:   0.05,
	}
	tier, reason := decideTier(s)
	if tier != TierSilver || reason != "dispute_demotion" {
		t.Errorf("got (%v, %q), want (Silver, dispute_demotion) — exactly one tier down from Gold", tier, reason)
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
	}
	tier, reason := decideTier(s)
	if tier != TierNew || reason != "" {
		t.Errorf("got (%v, %q), want (New, \"\") — an unresolved claim older than 7 days should block promotion", tier, reason)
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
		{500, TierHausTrust},
		{10000, TierHausTrust},
	}
	for _, c := range cases {
		if got := tierForOrders(c.orders); got != c.want {
			t.Errorf("tierForOrders(%d) = %v, want %v", c.orders, got, c.want)
		}
	}
}
