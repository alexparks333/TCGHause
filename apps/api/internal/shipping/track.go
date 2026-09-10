package shipping

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/platform"
)

// TrackingLocation is a checkpoint's city/state/country — never a raw
// street address (a carrier tracking event is a facility/region, not a
// mailing address), matching what Shippo's own track API returns.
type TrackingLocation struct {
	City    string `json:"city,omitempty"`
	State   string `json:"state,omitempty"`
	Zip     string `json:"zip,omitempty"`
	Country string `json:"country,omitempty"`
}

// TrackingCheckpoint is one scan event — "area by area," per the product
// ask, rather than just a single current status.
type TrackingCheckpoint struct {
	Status        string            `json:"status"`
	StatusDetails string            `json:"statusDetails"`
	Location      *TrackingLocation `json:"location,omitempty"`
	OccurredAt    time.Time         `json:"occurredAt"`
}

// TrackingInfo is the whole tracking page's data — current status plus
// every checkpoint, newest first (Shippo's own tracking_history array
// isn't guaranteed chronological — verified live against its test-mode
// carrier, see this feature's history — so OccurredAt is always
// re-sorted here, never trusted in whatever order the vendor returned it).
type TrackingInfo struct {
	Carrier        string               `json:"carrier"`
	TrackingNumber string               `json:"trackingNumber"`
	Status         string               `json:"status"`
	StatusDetails  string               `json:"statusDetails"`
	ETA            *time.Time           `json:"eta,omitempty"`
	Checkpoints    []TrackingCheckpoint `json:"checkpoints"`
}

type shippoTrackLocation struct {
	City    string `json:"city"`
	State   string `json:"state"`
	Zip     string `json:"zip"`
	Country string `json:"country"`
}

type shippoTrackEvent struct {
	Status        string               `json:"status"`
	StatusDetails string               `json:"status_details"`
	StatusDate    time.Time            `json:"status_date"`
	Location      *shippoTrackLocation `json:"location"`
}

type shippoTrackResponse struct {
	Carrier         string             `json:"carrier"`
	TrackingNumber  string             `json:"tracking_number"`
	ETA             *time.Time         `json:"eta"`
	TrackingStatus  shippoTrackEvent   `json:"tracking_status"`
	TrackingHistory []shippoTrackEvent `json:"tracking_history"`
	Messages        []shippoMsg        `json:"messages"`
}

// normalizeTrackingCarrier maps whatever this app already stored in
// orders.carrier (a rate/shipment provider display name — "USPS", or
// Pitney Bowes' own hardcoded "USPS") to the lowercase, underscore-joined
// token Shippo's public tracking endpoint expects ("usps", "dhl_express").
// Shippo's tracking lookup is a public carrier passthrough, not scoped to
// shipments it sold — it works for a Pitney-Bowes-bought USPS tracking
// number exactly the same as one Shippo itself issued, since both are
// real USPS tracking numbers under the hood.
func normalizeTrackingCarrier(carrier string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(carrier), " ", "_"))
}

func toTrackingLocation(l *shippoTrackLocation) *TrackingLocation {
	if l == nil || (l.City == "" && l.State == "" && l.Country == "") {
		return nil
	}
	return &TrackingLocation{City: l.City, State: l.State, Zip: l.Zip, Country: l.Country}
}

// TrackShipment calls Shippo's public track-a-shipment endpoint — a
// carrier passthrough that works for any real carrier tracking number
// regardless of who sold the label (see normalizeTrackingCarrier's own
// comment). Note found live: Shippo's TEST-mode tokens can only resolve
// the fake "shippo" carrier's canned test tracking numbers
// (SHIPPO_TRANSIT/SHIPPO_DELIVERED/etc) — a real carrier token like "usps"
// 400s in test mode with "usps is not a valid test tracking carrier."
// That's a real Shippo API limitation, not a bug here: this will resolve
// real USPS/UPS/etc. tracking once SHIPPO_API_TOKEN is a live key.
func (c *Client) TrackShipment(ctx context.Context, carrier, trackingNumber string) (*TrackingInfo, error) {
	var resp shippoTrackResponse
	if err := c.get(ctx, "/tracks/"+normalizeTrackingCarrier(carrier)+"/"+trackingNumber, &resp); err != nil {
		return nil, err
	}

	checkpoints := make([]TrackingCheckpoint, 0, len(resp.TrackingHistory))
	for _, h := range resp.TrackingHistory {
		checkpoints = append(checkpoints, TrackingCheckpoint{
			Status:        h.Status,
			StatusDetails: h.StatusDetails,
			Location:      toTrackingLocation(h.Location),
			OccurredAt:    h.StatusDate,
		})
	}
	sort.Slice(checkpoints, func(i, j int) bool {
		return checkpoints[i].OccurredAt.After(checkpoints[j].OccurredAt)
	})

	return &TrackingInfo{
		Carrier:        carrier,
		TrackingNumber: trackingNumber,
		Status:         resp.TrackingStatus.Status,
		StatusDetails:  resp.TrackingStatus.StatusDetails,
		ETA:            resp.ETA,
		Checkpoints:    checkpoints,
	}, nil
}

// HandleTrackShipment backs the Shipped step's "whole tracking page" — the
// same real carrier data regardless of whether the label was bought
// through Shippo or Pitney Bowes (TrackShipment's own doc comment). Either
// participant (buyer or seller) can view it; only they, same access rule
// as HandleGetForListing.
func HandleTrackShipment(pool *pgxpool.Pool, shippoClient *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, order.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if callerID != o.BuyerID && callerID != o.SellerID {
			http.Error(w, "not a participant in this order", http.StatusForbidden)
			return
		}
		if o.TrackingNumber == nil || *o.TrackingNumber == "" || o.Carrier == nil || *o.Carrier == "" {
			http.Error(w, "no tracking number recorded for this order yet", http.StatusNotFound)
			return
		}

		info, err := shippoClient.TrackShipment(r.Context(), *o.Carrier, *o.TrackingNumber)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(info)
	}
}
