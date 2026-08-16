drop index if exists listings_search_text_trgm_idx;
alter table listings drop column if exists search_text;
drop extension if exists pg_trgm;
