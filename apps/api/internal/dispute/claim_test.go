package dispute

import "testing"

func TestAutoAdjudicate_NoTrackingNotReceived(t *testing.T) {
	res, liable, matched := autoAdjudicate(ReasonNotReceivedNoTracking, false, false, 10000)
	if !matched || res != ResolutionRefundBuyer || liable != LiablePartySeller {
		t.Errorf("got (%v, %v, %v), want (refund_buyer, seller, true)", res, liable, matched)
	}
}

func TestAutoAdjudicate_TrackingDeliveredNotReceivedUnderThreshold(t *testing.T) {
	res, liable, matched := autoAdjudicate(ReasonNotReceivedTrackingDelivered, true, true, 4999)
	if !matched || res != ResolutionRefundBuyer || liable != LiablePartyPlatform {
		t.Errorf("got (%v, %v, %v), want (refund_buyer, platform, true)", res, liable, matched)
	}
}

func TestAutoAdjudicate_TrackingDeliveredNotReceivedAtOrAboveThreshold(t *testing.T) {
	// $50+ claims route to human review with a fraud check, per §9.3 — not
	// auto-resolved even though tracking shows delivered.
	res, liable, matched := autoAdjudicate(ReasonNotReceivedTrackingDelivered, true, true, 5000)
	if matched {
		t.Errorf("got (%v, %v, matched), want unmatched for a $50+ claim", res, liable)
	}
}

func TestAutoAdjudicate_NotAsDescribedAlwaysHumanReview(t *testing.T) {
	// "Flaw visible in listing photo" needs a human to compare photos —
	// deliberately never auto-adjudicated, see the doc comment on
	// autoAdjudicate.
	_, _, matched := autoAdjudicate(ReasonNotAsDescribed, true, true, 1000)
	if matched {
		t.Error("not_as_described should never auto-adjudicate")
	}
}

func TestAutoAdjudicate_TrackedButNotYetDelivered(t *testing.T) {
	// Tracking exists but hasn't scanned delivered yet — not the "no
	// tracking" rule (there IS tracking) and not the "delivered" rule
	// (it isn't delivered) — falls through to human review.
	_, _, matched := autoAdjudicate(ReasonNotReceivedNoTracking, true, false, 1000)
	if matched {
		t.Error("a claim with real tracking should not match the no-tracking auto-rule")
	}
}
