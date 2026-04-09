-- SPX Credit Spread Calculator cloud records.
-- Run this once in Supabase SQL Editor before using cloud sync.
-- The table uses Supabase Auth, so each logged-in user can only access their own rows.

create table if not exists public.spx_credit_spread_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  record_date date not null,
  spx_prev_close numeric not null,
  prev_vix_close numeric not null,
  spx_open numeric not null,
  trade_side text not null check (trade_side in ('CALL', 'PUT')),
  direction_source text,
  final_otm_pct numeric,
  exact_target_price numeric,
  outer_five_point_strike numeric,
  inner_five_point_strike numeric,
  note text,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, record_date)
);

alter table public.spx_credit_spread_records enable row level security;

drop policy if exists "Users can read own SPX calculator records" on public.spx_credit_spread_records;
drop policy if exists "Users can insert own SPX calculator records" on public.spx_credit_spread_records;
drop policy if exists "Users can update own SPX calculator records" on public.spx_credit_spread_records;
drop policy if exists "Users can delete own SPX calculator records" on public.spx_credit_spread_records;

create policy "Users can read own SPX calculator records"
  on public.spx_credit_spread_records
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own SPX calculator records"
  on public.spx_credit_spread_records
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own SPX calculator records"
  on public.spx_credit_spread_records
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own SPX calculator records"
  on public.spx_credit_spread_records
  for delete
  to authenticated
  using (auth.uid() = user_id);

