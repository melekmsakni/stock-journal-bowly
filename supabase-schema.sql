create table if not exists public.stock_history (
  date date primary key,
  items jsonb not null default '[]'::jsonb,
  phase text not null default 'opening',
  actual_stock jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.stock_history enable row level security;

drop policy if exists "Allow public read" on public.stock_history;
create policy "Allow public read"
on public.stock_history
for select
using (true);

drop policy if exists "Allow public write" on public.stock_history;
create policy "Allow public write"
on public.stock_history
for insert
with check (true);

drop policy if exists "Allow public update" on public.stock_history;
create policy "Allow public update"
on public.stock_history
for update
using (true)
with check (true);

drop policy if exists "Allow public delete" on public.stock_history;
create policy "Allow public delete"
on public.stock_history
for delete
using (true);

-- Enable Realtime so all connected clients receive live updates
alter publication supabase_realtime add table public.stock_history;

-- ============================================================
-- MIGRATION: Auth roles, profiles, cook_counts
-- Run this block in the Supabase SQL editor after the block above.
-- ============================================================

-- profiles ---------------------------------------------------------
-- Must be created BEFORE get_my_role() so the function can reference it.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin', 'cook')),
  full_name   text not null default '',
  email       text not null default '',
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: returns the calling user's role without triggering RLS recursion.
-- Defined here, after profiles exists, so PostgreSQL can validate the query.
create or replace function public.get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

drop policy if exists "profiles_select_own"    on public.profiles;
drop policy if exists "profiles_select_admin"  on public.profiles;
drop policy if exists "profiles_insert_admin"  on public.profiles;
drop policy if exists "profiles_delete_admin"  on public.profiles;

-- every user can read their own profile
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- admins can read all profiles
create policy "profiles_select_admin" on public.profiles
  for select using (public.get_my_role() = 'admin');

-- admins can create profiles for new cooks
create policy "profiles_insert_admin" on public.profiles
  for insert with check (public.get_my_role() = 'admin');

-- admins can delete profiles
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.get_my_role() = 'admin');

-- cook_counts -------------------------------------------------------
create table if not exists public.cook_counts (
  id           uuid primary key default gen_random_uuid(),
  cook_id      uuid not null references public.profiles(id) on delete cascade,
  date         date not null,
  item_name    text not null,
  unit         text not null default 'portions',
  count        numeric not null default 0,
  submitted_at timestamptz not null default now()
);

create index if not exists cook_counts_date_cook_idx
  on public.cook_counts (date, cook_id);

alter table public.cook_counts enable row level security;

drop policy if exists "cook_counts_cook_insert" on public.cook_counts;
drop policy if exists "cook_counts_cook_select" on public.cook_counts;
drop policy if exists "cook_counts_admin_select" on public.cook_counts;

-- cooks can only insert their own rows
create policy "cook_counts_cook_insert" on public.cook_counts
  for insert with check (
    cook_id = auth.uid() and public.get_my_role() = 'cook'
  );

-- cooks can only read their own rows (admins can read all)
create policy "cook_counts_cook_select" on public.cook_counts
  for select using (
    (cook_id = auth.uid() and public.get_my_role() = 'cook')
    or public.get_my_role() = 'admin'
  );

-- stock_history: restrict to admins only (drop the open public policies) ------
drop policy if exists "Allow public read"   on public.stock_history;
drop policy if exists "Allow public write"  on public.stock_history;
drop policy if exists "Allow public update" on public.stock_history;
drop policy if exists "Allow public delete" on public.stock_history;

drop policy if exists "stock_admin_select" on public.stock_history;
drop policy if exists "stock_admin_insert" on public.stock_history;
drop policy if exists "stock_admin_update" on public.stock_history;
drop policy if exists "stock_admin_delete" on public.stock_history;

create policy "stock_admin_select" on public.stock_history
  for select using (public.get_my_role() = 'admin');

create policy "stock_admin_insert" on public.stock_history
  for insert with check (public.get_my_role() = 'admin');

create policy "stock_admin_update" on public.stock_history
  for update using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

create policy "stock_admin_delete" on public.stock_history
  for delete using (public.get_my_role() = 'admin');

-- MIGRATION: add shift + password_plain to profiles (run if columns don't exist yet)
alter table public.profiles
  add column if not exists shift text not null default 'matin'
  check (shift in ('matin', 'après-midi', 'journée'));

alter table public.profiles
  add column if not exists password_plain text not null default '';

-- Allow admins to update any profile (name, email, shift, password_plain)
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- RPC: returns item names+units from the most recent stock_history row.
-- p_cook_id filters to only items assigned to that cook (null = all items).
-- Used by the cook UI (cooks have no direct access to stock_history).
create or replace function public.get_today_items(p_cook_id uuid default null)
returns table(name text, unit text)
language sql
security definer
stable
as $$
  select
    (item->>'name')::text                                             as name,
    coalesce(nullif(item->>'unit', ''), 'portions')::text            as unit
  from (
    select items
    from   public.stock_history
    order  by date desc
    limit  1
  ) recent,
  jsonb_array_elements(recent.items) as item
  where p_cook_id is null
    -- assigned_to can be a JSON array ["uuid",...] or legacy string "uuid"
    or (
      case jsonb_typeof(item->'assigned_to')
        when 'array'  then (item->'assigned_to') @> to_jsonb(p_cook_id::text)
        when 'string' then item->>'assigned_to' = p_cook_id::text
        else false
      end
    );
$$;
