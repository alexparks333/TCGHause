alter table payouts drop constraint payouts_kind_check;
alter table payouts add constraint payouts_kind_check
    check (kind in ('batched', 'per_order', 'instant'));
