-- Records the actual negotiated sale price for a fixed-format listing when
-- it differs from its own price_cents — currently only set when an offer
-- is accepted (internal/offer.Accept), which closes the listing at the
-- offered amount rather than the original asking price. Null means "sold
-- at price_cents" (a plain Buy It Now purchase) or "not sold yet".
alter table listings add column sold_price_cents bigint;
