-- Real watchers, not a fabricated number — see CLAUDE.md §6.13/§6.8.
create table watchlist (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users(id),
    listing_id uuid not null references listings(id),
    created_at timestamptz not null default now(),
    unique (user_id, listing_id)
);

create index watchlist_listing_id_idx on watchlist (listing_id);
create index watchlist_user_id_idx on watchlist (user_id);

alter table watchlist enable row level security;
