// Package catalog owns the category tree and the per-category
// item-specifics schema (game, set, card number, rarity, condition/grade,
// etc.). v1 hardcodes the game list (games.go) rather than the fully
// dynamic per-category schema table CLAUDE.md §6.2 describes long-term —
// that's a deliberate v2 upgrade once there's a real need to add games
// without a deploy, not something to build speculatively now.
package catalog
