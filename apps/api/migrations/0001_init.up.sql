-- Initial schema: users and the wallet ledger.
-- The ledger is append-only by convention (CLAUDE.md §5.1) — balance is
-- always SUM(amount_cents) WHERE user_id = ?, never a stored/mutated column.

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    id_verified_at  TIMESTAMPTZ
);

CREATE TABLE wallet_ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    amount_cents    BIGINT NOT NULL,
    reason          TEXT NOT NULL, -- e.g. 'deposit', 'sale_proceeds', 'escrow_hold', 'withdrawal'
    reference_id    UUID,          -- points at the order/escrow/withdrawal row that caused this entry
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wallet_ledger_entries_user_id_idx ON wallet_ledger_entries (user_id);
