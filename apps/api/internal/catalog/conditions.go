package catalog

// ConditionOrder is the raw-card condition scale, worst to best. Only
// applies to ungraded listings — graded slabs have a grade/company instead
// (CLAUDE.md §6.2) and are never excluded by a condition filter, since
// "condition" isn't a concept that applies to them. Keep in sync with the
// Sell wizard's condition dropdown (apps/web/components/sell-wizard/Step1Details.tsx).
var ConditionOrder = []string{
	"Damaged",
	"Heavily Played",
	"Moderately Played",
	"Lightly Played",
	"Near Mint",
}

// ConditionsAtOrAbove returns every condition at least as good as min (min
// itself and everything ranked higher), for a "minimum condition" filter —
// e.g. ConditionsAtOrAbove("Lightly Played") returns ["Lightly Played",
// "Near Mint"]. Returns nil if min isn't a recognized condition.
func ConditionsAtOrAbove(min string) []string {
	for i, c := range ConditionOrder {
		if c == min {
			return ConditionOrder[i:]
		}
	}
	return nil
}
