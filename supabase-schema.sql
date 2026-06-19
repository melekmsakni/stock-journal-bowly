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
