-- Life Tracker – step 3: food & calories
-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- Your own food list: products (from barcode / search), saved recipes, custom foods. Values per 100 g.
create table if not exists public.foods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null,
  brand         text,
  barcode       text,
  kind          text not null default 'custom' check (kind in ('product','recipe','custom')),
  kcal_100g     numeric(7,2) not null,
  protein_100g  numeric(6,2),
  carbs_100g    numeric(6,2),
  fat_100g      numeric(6,2),
  default_grams numeric(7,1),
  notes         text,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.food_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  logged_at  timestamptz not null default now(),
  meal       text not null default 'snack' check (meal in ('breakfast','lunch','dinner','snack')),
  name       text not null,
  grams      numeric(7,1),
  kcal       numeric(7,1) not null,
  protein_g  numeric(6,1),
  carbs_g    numeric(6,1),
  fat_g      numeric(6,1),
  kcal_low   numeric(7,1),           -- AI estimate range
  kcal_high  numeric(7,1),
  source     text not null default 'manual' check (source in ('manual','food','barcode','photo','recipe')),
  food_id    uuid references public.foods on delete set null,
  details    jsonb,                  -- AI breakdown (items, confidence, notes)
  created_at timestamptz not null default now()
);

create index if not exists food_logs_time_idx on public.food_logs (user_id, logged_at);
create index if not exists foods_barcode_idx  on public.foods (user_id, barcode);

do $$
declare t text;
begin
  foreach t in array array['foods','food_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
