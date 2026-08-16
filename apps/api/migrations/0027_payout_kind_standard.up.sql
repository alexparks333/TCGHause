-- Adds 'standard' as a payout kind — the free, seller-initiated
-- ~1-2-business-day payout on the Withdraw page (internal/payout.
-- TriggerStandardPayout), now that payouts are never triggered
-- automatically (cmd/worker's old payout_timer.go batch sweep is
-- removed): a payout only ever happens when a seller actually clicks
-- either "Standard Transfer" or "Instant Transfer". 'batched' is kept in
-- the allowed list for existing historical rows created by that old
-- automatic sweep, not used by any code path going forward.
alter table payouts drop constraint payouts_kind_check;
alter table payouts add constraint payouts_kind_check
    check (kind in ('batched', 'standard', 'per_order', 'instant'));
