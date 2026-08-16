package cardcatalog

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// maxResults caps a single autocomplete response — the Sell wizard shows a
// short dropdown, not a full results page.
const maxResults = 8

var (
	numberWordRe = regexp.MustCompile(`^\d+$`)
	nameTokenRe  = regexp.MustCompile(`[\s\-·,']+`)
)

// Search finds cards in the given AuctionHous game whose name matches
// query, ranked the same way TCG Haven's own search.ts ranks results
// (word-start prefix matching only — no substring matches). Returns
// (nil, nil, false) for a game TCG Haven doesn't track (games.go).
func (c *Client) Search(ctx context.Context, auctionHousGame, query string) ([]Card, bool, error) {
	slug, ok := gameSlug(auctionHousGame)
	if !ok {
		return nil, false, nil
	}

	cards, err := c.visibleCards(ctx, slug)
	if err != nil {
		return nil, true, err
	}

	nameQuery, numberFilter := parseSearchQuery(query)
	if nameQuery == "" && numberFilter == "" {
		return nil, true, nil
	}

	type scored struct {
		card  Card
		score int
	}
	var matches []scored
	for _, card := range cards {
		if numberFilter != "" && normNum(card.Number) != numberFilter {
			continue
		}
		score := 0
		if nameQuery != "" {
			score = scoreMatch(card.Name, nameQuery, card.Tags)
			if score < 0 {
				continue
			}
		}
		matches = append(matches, scored{card, score})
	}

	sort.SliceStable(matches, func(i, j int) bool { return matches[i].score > matches[j].score })

	if len(matches) > maxResults {
		matches = matches[:maxResults]
	}
	results := make([]Card, len(matches))
	for i, m := range matches {
		results[i] = m.card
	}
	return results, true, nil
}

// parseSearchQuery splits a raw query into a name portion and an optional
// bare-digit collector-number filter — port of TCG Haven's
// lib/api/catalog.ts parseSearchQuery. "Rayquaza 138" -> ("Rayquaza", "138").
func parseSearchQuery(raw string) (nameQuery, numberFilter string) {
	var names []string
	for _, w := range strings.Fields(raw) {
		if numberWordRe.MatchString(w) {
			if numberFilter == "" {
				numberFilter = w
			}
		} else {
			names = append(names, w)
		}
	}
	return strings.Join(names, " "), numberFilter
}

// normNum strips leading zeros for comparison ("088" == "88"). Returns the
// original string unchanged if it isn't purely numeric (e.g. Riftbound's
// "R01a" Rune cards), matching TCG Haven's own non-throwing behavior.
func normNum(n string) string {
	v, err := strconv.Atoi(n)
	if err != nil {
		return n
	}
	return strconv.Itoa(v)
}

// scoreMatch is a direct port of TCG Haven's lib/api/catalog.ts scoreMatch:
// word-start prefix matching only, never mid-word substring matching.
// Returns -1 if any query word fails to match the start of some name token
// (or tag). Scoring: exact token match +30, prefix match +15, tag hit +20,
// first-word-matches-first-token bonus +10.
func scoreMatch(name, query string, tags []string) int {
	tokens := tokenize(strings.ToLower(name))
	words := strings.Fields(strings.ToLower(query))

	score := 0
	for _, w := range words {
		switch {
		case containsExact(tokens, w):
			score += 30
		case containsPrefix(tokens, w):
			score += 15
		case tagHit(tags, w):
			score += 20
		default:
			return -1
		}
	}

	if len(words) > 0 && len(tokens) > 0 {
		first := words[0]
		if tokens[0] == first || strings.HasPrefix(tokens[0], first) {
			score += 10
		}
	}
	return score
}

func tokenize(name string) []string {
	var tokens []string
	for _, t := range nameTokenRe.Split(name, -1) {
		if t != "" {
			tokens = append(tokens, t)
		}
	}
	return tokens
}

func containsExact(tokens []string, w string) bool {
	for _, t := range tokens {
		if t == w {
			return true
		}
	}
	return false
}

func containsPrefix(tokens []string, w string) bool {
	for _, t := range tokens {
		if strings.HasPrefix(t, w) {
			return true
		}
	}
	return false
}

func tagHit(tags []string, w string) bool {
	for _, tag := range tags {
		t := strings.ToLower(tag)
		if t == w || strings.HasPrefix(t, w) {
			return true
		}
	}
	return false
}
