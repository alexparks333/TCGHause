-- Mirrors Supabase Auth's auth.users into our own public.users so foreign
-- keys (wallet_ledger_entries.user_id, and future listings/orders) reference
-- a table we own, without ever querying the auth schema directly.
--
-- Expects to run against a Supabase-provisioned Postgres instance — the
-- auth schema is created by Supabase, not by this migration.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, created_at)
  values (new.id, new.email, new.created_at)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Deny-by-default: with RLS enabled and no policies, PostgREST requests
-- using the anon/authenticated roles (e.g. the publishable key exposed to
-- the browser) cannot read or write these tables at all. The Go backend
-- connects with the direct Postgres connection string (the postgres role),
-- which bypasses RLS entirely — this is defense in depth against the
-- frontend ever querying wallet/user data straight through Supabase
-- instead of through apps/api.
alter table public.users enable row level security;
alter table public.wallet_ledger_entries enable row level security;
