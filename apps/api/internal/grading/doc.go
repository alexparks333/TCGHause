// Package grading verifies graded-slab cert numbers against PSA/BGS/CGC
// public lookups before a listing goes live at Tier 2/3 trust. v1 is
// cert-lookup only; physical ship-to-inspect authentication is a v2+
// business-development dependency. See CLAUDE.md §5.5 and §6.6.
package grading
