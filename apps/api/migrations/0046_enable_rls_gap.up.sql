-- Closes a real gap flagged by Supabase's own security advisor
-- ("rls_disabled_in_public" — "Anyone with your project URL can read,
-- edit, and delete all data in this table"): every table below was created
-- without the `alter table ... enable row level security` line every
-- other table in this repo gets (see 0002_supabase_auth_sync's own doc
-- comment on why: deny-by-default RLS is what stops the browser's
-- publishable key from reading/writing app data straight through
-- PostgREST, forcing every access through apps/api's own auth instead).
-- These eleven simply got missed as new features shipped — orders,
-- payouts, and claims/chargebacks are exactly the tables that should never
-- have been left exposed. Zero policies added, same as every other table
-- here: the Go API's direct DATABASE_URL connection (the `postgres` role)
-- bypasses RLS entirely and is the only thing that ever needs to touch
-- these tables, so there is no PostgREST-facing use case to write a policy
-- for.
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_evidence enable row level security;
alter table payouts enable row level security;
alter table payout_orders enable row level security;
alter table claims enable row level security;
alter table claim_events enable row level security;
alter table chargebacks enable row level security;
alter table haus_trust_applications enable row level security;
alter table stripe_events enable row level security;
alter table tier_events enable row level security;
