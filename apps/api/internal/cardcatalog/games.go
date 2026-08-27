package cardcatalog

// SupportedGames is every AuctionHous game TCG Haven's catalog actually
// covers, in gameSlug's own order — what SearchAll loops over when a
// caller (the Favorite Card widget picker) has no single game to search
// within, unlike the Sell wizard's CardSearch.
var SupportedGames = []string{"Pokémon", "Disney Lorcana", "Riftbound"}

// gameSlug maps AuctionHous's catalog.Game values to TCG Haven's Firestore
// game keys ("catalog/{slug}/cards"). Only the three games TCG Haven
// actually tracks have an entry — MTG, Yu-Gi-Oh!, and Sports Cards return
// ok=false, meaning the Sell wizard just gets no suggestions for them.
func gameSlug(auctionHousGame string) (slug string, ok bool) {
	switch auctionHousGame {
	case "Pokémon":
		return "pokemon", true
	case "Disney Lorcana":
		return "lorcana", true
	case "Riftbound":
		return "riftbound", true
	default:
		return "", false
	}
}
