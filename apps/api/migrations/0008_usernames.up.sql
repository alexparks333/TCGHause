-- Public username (eBay-style nickname) — replaces email as the seller
-- identity shown throughout the site. Nullable by design: Google OAuth
-- signups have no username until they complete the "claim your username"
-- step; a unique index on lower(username) still allows unlimited NULLs,
-- which is exactly the "hasn't claimed one yet" state.
alter table public.users add column username text;

-- Case-insensitive uniqueness. Defense-in-depth against the availability
-- check (GET /usernames/available) racing a concurrent insert/update —
-- that check is inherently check-then-act, not atomic; this constraint is
-- what makes the race safe, not what makes it impossible.
create unique index users_username_lower_idx on public.users (lower(username));

-- 3-20 chars, alphanumeric + underscore only — same rule enforced
-- client-side and in internal/user's Go validation; this is the last line
-- of defense if either of those is ever bypassed.
alter table public.users add constraint users_username_format_chk
    check (username is null or username ~ '^[a-zA-Z0-9_]{3,20}$');

-- Rewrite the auth-sync trigger (from 0002) to also populate username on
-- first insert: password signups pass "username" via Supabase user
-- metadata (SignUpForm's options.data.username -> auth.users's
-- raw_user_meta_data), which this trigger reads. Google OAuth signups have
-- no "username" key in their metadata, so it stays NULL — filled in later
-- by the claim-username flow via SetUsername, not this trigger.
--
-- The collision-retry loop is defense-in-depth: SignUpForm debounce-checks
-- availability before submit, so a collision here should be rare, but two
-- tabs racing the same desired username must not both silently succeed or
-- crash the trigger (which would abort the whole auth.users insert /
-- signUp call).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  desired_username text;
  candidate text;
  suffix int := 0;
begin
  desired_username := nullif(trim(new.raw_user_meta_data->>'username'), '');

  begin
    insert into public.users (id, email, created_at, username)
    values (new.id, new.email, new.created_at, desired_username)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- ON CONFLICT (id) already absorbs an id collision; landing here
      -- means desired_username collided with an existing user's username.
      candidate := desired_username;
      loop
        suffix := suffix + 1;
        candidate := desired_username || '_' || suffix;
        begin
          insert into public.users (id, email, created_at, username)
          values (new.id, new.email, new.created_at, candidate)
          on conflict (id) do nothing;
          exit;
        exception
          when unique_violation then
            continue;
        end;
      end loop;
  end;
  return new;
end;
$$;
