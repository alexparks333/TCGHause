drop index if exists messages_offer_id_key;
alter table messages drop column offer_id;
alter table messages drop column kind;
