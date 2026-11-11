-- Life Tracker – step 4: spending
-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.spend_categories (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  name           text not null,
  icon           text not null default '💶',
  monthly_budget numeric(10,2),
  sort           int not null default 100,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (user_id, name)
);

-- Memberships, subscriptions, rent … booked automatically into expenses when due.
create table if not exists public.recurring_expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  amount      numeric(10,2) not null check (amount > 0),
  category_id uuid references public.spend_categories on delete set null,
  interval    text not null default 'monthly' check (interval in ('weekly','monthly','quarterly','yearly')),
  start_date  date not null,          -- first payment; later ones follow the interval from here
  next_due    date not null,          -- next payment not yet booked
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  spent_on     date not null default current_date,
  amount       numeric(10,2) not null check (amount > 0),
  category_id  uuid references public.spend_categories on delete set null,
  note         text,
  recurring_id uuid references public.recurring_expenses on delete set null,
  created_at   timestamptz not null default now(),
  unique (recurring_id, spent_on)     -- a recurring payment is booked once per date, even from two devices
);

create index if not exists expenses_day_idx on public.expenses (user_id, spent_on);

do $$
declare t text;
begin
  foreach t in array array['spend_categories','recurring_expenses','expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
