CREATE TABLE wallet_ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    amount_cents    BIGINT NOT NULL,
    reason          TEXT NOT NULL,
    reference_id    UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wallet_ledger_entries_user_id_idx ON wallet_ledger_entries (user_id);

ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
