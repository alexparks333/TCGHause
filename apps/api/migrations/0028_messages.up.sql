-- Real buyer/seller direct messaging (CLAUDE.md §6.13 listed this as the
-- last still-mock account surface — lib/mock-account.ts's myMessages).
-- One thread per unordered pair of users, not per listing: eBay-style "ask
-- a question" from a listing starts a conversation, but two people only
-- ever have one running conversation with each other, the same way iMessage
-- or Gmail don't fork a new thread per topic. listing_id is just the
-- context the thread happened to start from (shown as "About: <title>" in
-- the UI), not part of the identity of the conversation.
--
-- participant_one/participant_two are always stored with participant_one <
-- participant_two (enforced by the check constraint, maintained by
-- internal/message.StartOrGetThread) so "the thread between A and B" has
-- exactly one row no matter which of the two initiated it — the unique
-- index below is what actually prevents a duplicate thread from a race
-- between two concurrent "message this seller" clicks.
create table message_threads (
    id                     uuid primary key default gen_random_uuid(),
    participant_one        uuid not null references users(id),
    participant_two        uuid not null references users(id),
    listing_id             uuid references listings(id),
    last_message_at        timestamptz not null default now(),
    last_message_preview   text,
    last_message_sender_id uuid references users(id),
    created_at             timestamptz not null default now(),
    check (participant_one < participant_two)
);

create unique index message_threads_participants_idx
    on message_threads (participant_one, participant_two);

-- Powers "my threads, newest first" for both participants.
create index message_threads_p1_last_message_idx
    on message_threads (participant_one, last_message_at desc);
create index message_threads_p2_last_message_idx
    on message_threads (participant_two, last_message_at desc);

create table messages (
    id         uuid primary key default gen_random_uuid(),
    thread_id  uuid not null references message_threads(id),
    sender_id  uuid not null references users(id),
    body       text not null check (char_length(body) between 1 and 4000),
    created_at timestamptz not null default now()
);

-- The hot query is "every message in this thread, oldest first" — an open
-- conversation's full history, not a filtered/aggregated view.
create index messages_thread_id_created_at_idx on messages (thread_id, created_at);

-- Per-participant read state, separate from the messages themselves —
-- same reasoning as notifications.read_at, but scoped to "read up to this
-- point in the thread" rather than one flag per row, since marking an
-- entire conversation read on open is one upsert instead of an UPDATE over
-- every message in it. Unread count for a user is: threads where the
-- latest message is from the other participant AND is newer than this
-- row's last_read_at (or the thread has no row here at all yet).
create table message_thread_reads (
    thread_id     uuid not null references message_threads(id),
    user_id       uuid not null references users(id),
    last_read_at  timestamptz not null default now(),
    primary key (thread_id, user_id)
);

alter table message_threads enable row level security;
alter table messages enable row level security;
alter table message_thread_reads enable row level security;
