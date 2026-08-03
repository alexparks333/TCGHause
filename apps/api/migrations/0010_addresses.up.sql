-- One address per user, used both directions: ship-to when buying,
-- ship-from when selling. Plain PII, not a payment instrument — normal
-- Postgres storage is the right bar here (unlike bank/payout details,
-- which must never be stored directly; see CLAUDE.md §5.1/§7 — that
-- piece is still on hold pending legal review and explicitly out of
-- scope for this migration).
create table public.addresses (
    user_id       uuid primary key references public.users(id),
    full_name     text not null,
    line1         text not null,
    line2         text,
    city          text not null,
    state         text not null,
    postal_code   text not null,
    country       text not null,
    phone         text,
    updated_at    timestamptz not null default now()
);

-- Same deny-by-default posture as every other app-owned table (CLAUDE.md
-- §6.12) — the Go API's direct DATABASE_URL connection bypasses RLS, this
-- just blocks PostgREST's anon/authenticated roles. Especially important
-- here: an address must never be reachable through Supabase's REST layer
-- with just a leaked publishable key.
alter table public.addresses enable row level security;
