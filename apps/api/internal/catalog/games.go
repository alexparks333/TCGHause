package catalog

// Game is one of the fixed set of trading card games the marketplace
// supports. Keep this in sync with the CHECK constraint on listings.game
// in apps/api/migrations/0003_listings.up.sql — there's no dynamic
// per-game schema yet (CLAUDE.md §6.2's full item-specifics-schema table
// is a v2 upgrade once there's a real need to add games without a deploy).
type Game string

const (
	GamePokemon   Game = "Pokémon"
	GameMTG       Game = "Magic: The Gathering"
	GameYuGiOh    Game = "Yu-Gi-Oh!"
	GameLorcana   Game = "Disney Lorcana"
	GameRiftbound Game = "Riftbound"
	GameSports    Game = "Sports Cards"
)

var AllGames = []Game{
	GamePokemon, GameMTG, GameYuGiOh, GameLorcana, GameRiftbound, GameSports,
}

func IsValidGame(g string) bool {
	for _, game := range AllGames {
		if string(game) == g {
			return true
		}
	}
	return false
}
