-- Life Tracker – step 4b: spending accounts (Personal, Lifewatch, …)
-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.spend_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  icon       text not null default '👤',
  sort       int not null default 100,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- null = the default (first) account, so existing entries count as "Personal".
alter table public.expenses           add column if not exists account_id uuid references public.spend_accounts on delete set null;
alter table public.recurring_expenses add column if not exists account_id uuid references public.spend_accounts on delete set null;

create index if not exists expenses_account_idx on public.expenses (user_id, account_id, spent_on);

alter table public.spend_accounts enable row level security;
drop policy if exists "own rows" on public.spend_accounts;
create policy "own rows" on public.spend_accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
