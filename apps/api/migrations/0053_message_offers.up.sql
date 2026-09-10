-- Lets an offer (internal/offer) post itself as a native message in the
-- real conversation between its buyer and seller, alongside plain text —
-- kind distinguishes the two, offer_id points at the live row whose
-- amount/status is always re-read fresh (never frozen at message-creation
-- time), so accepting/declining anywhere (this thread, the listing page,
-- Bids/Offers) is reflected the next time this message is fetched.
alter table messages add column kind text not null default 'text' check (kind in ('text', 'offer'));
alter table messages add column offer_id uuid references offers(id);

-- One message per offer — internal/message.CreateOfferMessage is only ever
-- called once, from internal/offer.Submit.
create unique index messages_offer_id_key on messages (offer_id) where offer_id is not null;
