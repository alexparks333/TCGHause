-- Backs the "Save a Card" account-settings feature (internal/paymentmethod)
-- — a lazily-created Stripe Customer per user, so a saved card can be
-- reused at Buy It Now checkout instead of retyping it every time. Actual
-- card data never touches our database or backend at all — only Stripe's
-- customer/payment-method ids do, same PCI-scope reasoning as CLAUDE.md §7
-- already lays out for the (still-pending) real wallet.
alter table users add column stripe_customer_id text;

create unique index users_stripe_customer_id_idx on users (stripe_customer_id)
    where stripe_customer_id is not null;
