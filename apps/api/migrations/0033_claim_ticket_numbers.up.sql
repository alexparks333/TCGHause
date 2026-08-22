-- Human-facing ticket numbers for claims (e.g. "CLM-000123"), separate from
-- the internal uuid id — bigserial gives every claim a stable, sequential,
-- never-reused number the way a real support ticketing system would,
-- without renumbering existing rows.
alter table claims add column ticket_no bigserial unique;
