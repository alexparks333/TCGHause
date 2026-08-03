-- Restore exactly 0002's post-migration state.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, created_at)
  values (new.id, new.email, new.created_at)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.users drop constraint if exists users_username_format_chk;
drop index if exists users_username_lower_idx;
alter table public.users drop column if exists username;
