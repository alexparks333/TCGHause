// Package buyerreview is the buyer-side mirror of internal/feedback: a
// seller can leave exactly one rating+tag+comment on the buyer of one of
// their orders, and a buyer's aggregate stats (purchases made, refund rate,
// claim rate, and a plurality "trustworthy/suspicious/aggressive" tag) are
// computed live from orders/claims/buyer_reviews for display on the
// seller's order page. See migrations/0043_buyer_reviews.
package buyerreview
