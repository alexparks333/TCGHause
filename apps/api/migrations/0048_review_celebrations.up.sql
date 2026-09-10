-- Mirrors auctions.buyer_celebrated_at/seller_celebrated_at (0014) but for
-- "someone left you a review" — lets the recipient get a one-time
-- CelebrationToast pop-up (internal/auction.PendingCelebrations' new
-- Reviews field) independent of the notifications-bell's own read_at,
-- same as a win/sale toast plays once regardless of whether the bell
-- notification for it has been opened.
alter table seller_reviews add column celebrated_at timestamptz;
alter table buyer_reviews add column celebrated_at timestamptz;
