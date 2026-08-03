alter table public.wallet_ledger_entries disable row level security;
alter table public.users disable row level security;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
