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
// suggestions for MTG/Yu-Gi-Oh!/Sports Cards.
func HandleSearch(client *Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		game := r.URL.Query().Get("game")
		q := r.URL.Query().Get("q")
		if game == "" || q == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]Card{})
			return
		}

		cards, _, err := client.Search(r.Context(), game, q)
		if err != nil {
			log.Printf("cardcatalog: search failed for game=%s: %v", game, err)
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
