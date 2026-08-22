package shipping

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
)

// deliveryEvent is intentionally carrier-agnostic — this is NOT Shippo's or
// EasyPost's actual webhook payload shape (CLAUDE.md §6.11 names those as
// the intended vendors), which this repo has no account or SDK access to
// verify against yet. This is a stand-in that real vendor integration
// should replace: a real integration adds vendor-specific signature
// verification (their scheme, not the shared-secret HMAC below) and a
// tracking-number-validation API call at ship time (design doc v2 §5.3's
// evidence requirement #1), neither of which exists here. What IS real:
// the order-state-machine effect of a delivery event (internal/order.
// MarkDelivered) — swapping in a real carrier later only touches this
// file, not the domain logic it calls into.
type deliveryEvent struct {
	TrackingNumber string `json:"trackingNumber"`
	Event          string `json:"event"` // only "delivered" does anything today
}

// HandleDeliveryWebhook verifies an HMAC-SHA256 signature (X-Signature
// header, hex-encoded, over the raw body) against webhookSecret, then
// advances the matching order's state on a "delivered" event
// (order.MarkDelivered). Any other event type is accepted (200) and
// ignored — same "don't fail on an event we don't act on" posture as
// internal/webhook's Stripe dispatch.
func HandleDeliveryWebhook(pool *pgxpool.Pool, paymentClient *payment.Client, webhookSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := readAndVerify(r, webhookSecret)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var evt deliveryEvent
		if err := json.Unmarshal(body, &evt); err != nil || evt.TrackingNumber == "" {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}

		if evt.Event != "delivered" {
			w.WriteHeader(http.StatusOK)
			return
		}

		o, err := order.GetByTrackingNumber(r.Context(), pool, evt.TrackingNumber)
		if err != nil {
			if errors.Is(err, order.ErrNotFound) {
				// Nothing to do — a tracking number this platform never
				// recorded (or already-processed duplicate delivery,
				// depending on the real carrier's redelivery behavior).
				w.WriteHeader(http.StatusOK)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if o.State != order.StateShipped {
			// Already delivered (a redelivered webhook) or in some other
			// state entirely — MarkDelivered's own Transition call would
			// reject this anyway; short-circuiting here just avoids a
			// noisy ErrInvalidTransition log for the common redelivery case.
			w.WriteHeader(http.StatusOK)
			return
		}

		if err := order.MarkDelivered(r.Context(), pool, paymentClient, o.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

var errInvalidSignature = errors.New("invalid webhook signature")

func readAndVerify(r *http.Request, webhookSecret string) ([]byte, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(r.Header.Get("X-Signature"))) {
		return nil, errInvalidSignature
	}
	return body, nil
}
