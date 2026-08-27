package cardcatalog

import (
	"encoding/json"
	"log"
	"net/http"
)

// HandleSearch backs GET /catalog/search?game=&q= — public, unauthenticated
// (same as GET /listings), since it never touches anything user-specific.
// Returns an empty array (not an error) for a game TCG Haven doesn't track,
// so the Sell wizard can call this unconditionally and just get no
// suggestions for MTG/Yu-Gi-Oh!/Sports Cards. game is optional: omitting it
// (with q still present) searches across every SupportedGames entry and
// merges the results — what the Favorite Card widget picker uses, since it
// has no single game already chosen the way the Sell wizard's CardSearch
// does.
func HandleSearch(client *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		game := r.URL.Query().Get("game")
		q := r.URL.Query().Get("q")
		if q == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]Card{})
			return
		}

		var cards []Card
		var err error
		if game == "" {
			cards, err = client.SearchAll(r.Context(), q)
		} else {
			cards, _, err = client.Search(r.Context(), game, q)
		}
		if err != nil {
			log.Printf("cardcatalog: search failed for game=%q: %v", game, err)
			http.Error(w, "card catalog temporarily unavailable", http.StatusBadGateway)
			return
		}
		if cards == nil {
			cards = []Card{}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cards)
	}
}
