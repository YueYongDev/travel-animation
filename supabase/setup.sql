create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  display_name text,
  credits integer not null default 10 check (credits >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null,
  reason text not null,
  balance_after integer not null check (balance_after >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_timestamp on public.profiles;
create trigger set_profiles_timestamp
before update on public.profiles
for each row
execute procedure public.set_timestamp();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_display_name text;
begin
  resolved_display_name :=
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  if resolved_display_name is null then
    resolved_display_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;

  insert into public.profiles (id, email, display_name, credits)
  values (new.id, new.email, resolved_display_name, 10)
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);

  insert into public.credit_transactions (user_id, amount, reason, balance_after, metadata)
  values (
    new.id,
    10,
    'signup_bonus',
    10,
    jsonb_build_object('source', 'auth_trigger')
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

with inserted_profiles as (
  insert into public.profiles (id, email, display_name, credits)
  select
    users.id,
    users.email,
    coalesce(
      nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(users.email, ''), '@', 1)
    ),
    10
  from auth.users as users
  where not exists (
    select 1
    from public.profiles
    where profiles.id = users.id
  )
  returning id, credits
)
insert into public.credit_transactions (user_id, amount, reason, balance_after, metadata)
select
  inserted_profiles.id,
  10,
  'signup_bonus',
  inserted_profiles.credits,
  jsonb_build_object('source', 'backfill')
from inserted_profiles;

alter table public.profiles enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own"
on public.credit_transactions
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.consume_credits(
  requested_amount integer default 1,
  requested_reason text default 'video_export',
  request_metadata jsonb default '{}'::jsonb
)
returns table (
  credits integer,
  charged integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  next_balance integer;
  current_user_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if requested_amount is null or requested_amount <= 0 then
    raise exception 'requested_amount must be greater than 0';
  end if;

  select profiles.credits
    into current_balance
  from public.profiles
  where profiles.id = current_user_id
  for update;

  if current_balance is null then
    raise exception 'Profile not found';
  end if;

  if current_balance < requested_amount then
    raise exception 'Insufficient credits';
  end if;

  next_balance := current_balance - requested_amount;

  update public.profiles
    set credits = next_balance
  where id = current_user_id;

  insert into public.credit_transactions (user_id, amount, reason, balance_after, metadata)
  values (
    current_user_id,
    requested_amount * -1,
    requested_reason,
    next_balance,
    coalesce(request_metadata, '{}'::jsonb)
  );

  return query
  select next_balance, requested_amount;
end;
$$;

grant execute on function public.consume_credits(integer, text, jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end;
$$;
