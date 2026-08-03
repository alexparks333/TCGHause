-- Seller public profiles: a bio users write about themselves, and a v1
-- ungated rating+comment system (CLAUDE.md §6.3 describes a future
-- detailed-axis, purchase-verified version — there's no Order system yet
-- to gate against, so this is deliberately simpler: any logged-in user can
-- leave one rating+comment per seller).
alter table public.users add column bio text;
alter table public.users add constraint users_bio_length_chk
    check (bio is null or char_length(bio) <= 500);

create table public.seller_reviews (
    id          uuid primary key default gen_random_uuid(),
    seller_id   uuid not null references public.users(id),
    reviewer_id uuid not null references public.users(id),
    rating      smallint not null check (rating between 1 and 5),
    comment     text check (comment is null or char_length(comment) <= 1000),
    created_at  timestamptz not null default now(),
    unique (seller_id, reviewer_id)
);
create index seller_reviews_seller_id_idx on public.seller_reviews (seller_id);

-- Same deny-by-default posture as every other app-owned table (CLAUDE.md
-- §6.12) — the Go API's direct DATABASE_URL connection bypasses RLS, this
-- just blocks PostgREST's anon/authenticated roles.
alter table public.seller_reviews enable row level security;
