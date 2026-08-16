alter table message_thread_reads disable row level security;
alter table messages disable row level security;
alter table message_threads disable row level security;

drop table if exists message_thread_reads;
drop table if exists messages;

drop index if exists message_threads_p2_last_message_idx;
drop index if exists message_threads_p1_last_message_idx;
drop index if exists message_threads_participants_idx;
drop table if exists message_threads;
