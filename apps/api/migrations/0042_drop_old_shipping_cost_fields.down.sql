alter table listings add column free_shipping boolean not null default false;
alter table listings add column shipping_cost_cents bigint not null default 0;

update listings set
    free_shipping = shipping_preset in ('free_envelope', 'free_bubble_mailer', 'free_box'),
    shipping_cost_cents = case
        when shipping_preset = 'tracked_envelope' then 151
        when shipping_preset = 'shippo_ground_advantage' then coalesce(estimated_shipping_cents, 0)
        else 0
    end;
