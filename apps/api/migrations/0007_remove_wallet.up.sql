-- Wallet deposits are on hold for legal review (money-transmitter licensing,
-- CLAUDE.md §7) — drop the ledger table rather than leave dead schema
-- around implying the feature is live. Re-add via a fresh migration once
-- legal has signed off, not by reverting this one.
DROP TABLE IF EXISTS wallet_ledger_entries;
