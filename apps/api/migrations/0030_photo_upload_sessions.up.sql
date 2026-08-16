-- Phone-to-desktop QR photo handoff (Sell wizard) — the session id itself is
-- the bearer credential for the (deliberately unauthenticated) phone-side
-- upload endpoint, see internal/photosession. Deny-by-default RLS, zero
-- policies, same posture as users — only Go's direct DATABASE_URL connection
-- ever touches this table, never PostgREST.
create table photo_upload_sessions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users(id),
    photo_urls text[] not null default '{}',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index photo_upload_sessions_user_id_idx on photo_upload_sessions (user_id);
create index photo_upload_sessions_expires_at_idx on photo_upload_sessions (expires_at);

alter table photo_upload_sessions enable row level security;
