// Package seller computes seller tier (Probation / Trusted / Verified) and
// listing caps from stored sales/dispute/feedback history on a schedule,
// never from a hand-set or cached-only field, so demotion and appeals stay
// auditable. See CLAUDE.md §5.4 and §6.4.
package seller
