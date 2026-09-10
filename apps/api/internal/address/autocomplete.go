package address

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// AutocompleteClient wraps Google's Places API (New) — a real, human-set-up
// Google Cloud API key (Places API (New) enabled, billing attached, see
// CLAUDE.md §10), not a stub — added because free-text address fields kept
// producing addresses that read fine to a person but failed Pitney Bowes'
// stricter USPS-backed validation (a wrong city/ZIP pairing, "USA" instead
// of "US", etc — see address.Normalize's own history of one such gap).
// Suggesting real, USPS-known addresses as the seller/buyer types is a
// prevention for that whole class of problem, not just a UX nicety.
// Nil (not an error) when GOOGLE_PLACES_API_KEY is unset — same graceful-
// degradation pattern as every other optional integration in this repo:
// the autocomplete endpoints just aren't registered, and the frontend
// falls back to a plain text input.
type AutocompleteClient struct {
	apiKey string
	hc     *http.Client
}

func NewAutocompleteClient(apiKey string) *AutocompleteClient {
	if apiKey == "" {
		return nil
	}
	return &AutocompleteClient{apiKey: apiKey, hc: &http.Client{Timeout: 10 * time.Second}}
}

func (c *AutocompleteClient) IsConfigured() bool {
	return c != nil
}

// Suggestion is one candidate address as the caller types — deliberately
// thin (just enough to render a dropdown row and re-request the full
// address on selection via Resolve) rather than the full Places response
// shape, which carries a lot this app has no use for.
type Suggestion struct {
	PlaceID string `json:"placeId"`
	Text    string `json:"text"`
}

type placesAutocompleteRequest struct {
	Input               string   `json:"input"`
	IncludedRegionCodes []string `json:"includedRegionCodes"`
	LanguageCode        string   `json:"languageCode"`
}

type placesAutocompleteResponse struct {
	Suggestions []struct {
		PlacePrediction struct {
			PlaceID string `json:"placeId"`
			Text    struct {
				Text string `json:"text"`
			} `json:"text"`
		} `json:"placePrediction"`
	} `json:"suggestions"`
}

// Suggest returns candidate addresses for whatever's been typed so far,
// restricted to the US (CLAUDE.md §6.11 — this app is domestic-only in
// v1, so a Canadian or UK suggestion would just be noise). Empty query
// deliberately returns no suggestions rather than erroring — the frontend
// calls this on every keystroke past a short minimum length.
func (c *AutocompleteClient) Suggest(ctx context.Context, query string) ([]Suggestion, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}

	reqBody, err := json.Marshal(placesAutocompleteRequest{
		Input:               query,
		IncludedRegionCodes: []string{"us"},
		LanguageCode:        "en",
	})
	if err != nil {
		return nil, fmt.Errorf("marshal places autocomplete request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://places.googleapis.com/v1/places:autocomplete", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("build places autocomplete request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.apiKey)

	var resp placesAutocompleteResponse
	if err := c.do(req, &resp); err != nil {
		return nil, err
	}

	suggestions := make([]Suggestion, 0, len(resp.Suggestions))
	for _, s := range resp.Suggestions {
		if s.PlacePrediction.PlaceID == "" {
			continue
		}
		suggestions = append(suggestions, Suggestion{
			PlaceID: s.PlacePrediction.PlaceID,
			Text:    s.PlacePrediction.Text.Text,
		})
	}
	return suggestions, nil
}

type placesDetailsResponse struct {
	AddressComponents []struct {
		LongText  string   `json:"longText"`
		ShortText string   `json:"shortText"`
		Types     []string `json:"types"`
	} `json:"addressComponents"`
}

// ResolvedAddress is the subset of Address that Google Places can actually
// fill in — never FullName or Phone, which stay whatever the person
// already typed (Places has no concept of either).
type ResolvedAddress struct {
	Line1      string `json:"line1"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postalCode"`
	Country    string `json:"country"`
}

func hasType(types []string, want string) bool {
	for _, t := range types {
		if t == want {
			return true
		}
	}
	return false
}

// Resolve turns a suggestion's placeId (from Suggest) into structured
// address fields — Places' addressComponents come back as one flat array
// tagged by type (street_number/route/locality/...), not pre-split into
// our Address shape, so this is the parsing Suggest alone can't do.
func (c *AutocompleteClient) Resolve(ctx context.Context, placeID string) (*ResolvedAddress, error) {
	if strings.TrimSpace(placeID) == "" {
		return nil, fmt.Errorf("shipping: missing placeId")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://places.googleapis.com/v1/places/"+url.PathEscape(placeID), nil)
	if err != nil {
		return nil, fmt.Errorf("build places details request: %w", err)
	}
	req.Header.Set("X-Goog-Api-Key", c.apiKey)
	req.Header.Set("X-Goog-FieldMask", "addressComponents")

	var resp placesDetailsResponse
	if err := c.do(req, &resp); err != nil {
		return nil, err
	}

	var streetNumber, route, locality, sublocality, state, postalCode, postalCodeSuffix, country string
	for _, comp := range resp.AddressComponents {
		switch {
		case hasType(comp.Types, "street_number"):
			streetNumber = comp.LongText
		case hasType(comp.Types, "route"):
			route = comp.LongText
		case hasType(comp.Types, "locality"):
			locality = comp.LongText
		case hasType(comp.Types, "sublocality") || hasType(comp.Types, "sublocality_level_1"):
			sublocality = comp.LongText
		case hasType(comp.Types, "administrative_area_level_1"):
			state = comp.ShortText
		case hasType(comp.Types, "postal_code"):
			postalCode = comp.LongText
		case hasType(comp.Types, "postal_code_suffix"):
			postalCodeSuffix = comp.LongText
		case hasType(comp.Types, "country"):
			country = comp.ShortText
		}
	}

	city := locality
	if city == "" {
		city = sublocality
	}
	if postalCodeSuffix != "" {
		postalCode = postalCode + "-" + postalCodeSuffix
	}

	return &ResolvedAddress{
		Line1:      strings.TrimSpace(streetNumber + " " + route),
		City:       city,
		State:      state,
		PostalCode: postalCode,
		Country:    country,
	}, nil
}

func (c *AutocompleteClient) do(req *http.Request, out any) error {
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("places request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read places response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("places api returned %d: %s", resp.StatusCode, string(body))
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("decode places response: %w", err)
		}
	}
	return nil
}
