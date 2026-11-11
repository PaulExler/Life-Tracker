-- Life Tracker – step 1 schema (settings, tasks, habits, water)
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.settings (
  user_id        uuid primary key default auth.uid() references auth.users on delete cascade,
  water_goal_ml  int  not null default 2500,
  calorie_goal   int  not null default 2500,
  protein_goal_g int,
  updated_at     timestamptz not null default now()
);

create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  title      text not null,
  notes      text,
  due_at     timestamptz,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);

-- days: JS weekday numbers, 0 = Sunday … 6 = Saturday
create table if not exists public.habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  days       smallint[] not null default '{0,1,2,3,4,5,6}',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  habit_id   uuid not null references public.habits on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  unique (habit_id, day)
);

create table if not exists public.water_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  amount_ml  int not null check (amount_ml > 0),
  logged_at  timestamptz not null default now()
);

create index if not exists tasks_user_due_idx  on public.tasks (user_id, due_at);
create index if not exists habit_logs_day_idx  on public.habit_logs (user_id, day);
create index if not exists water_logs_time_idx on public.water_logs (user_id, logged_at);

-- Row Level Security: every user only ever sees and changes their own rows.
do $$
declare t text;
begin
  foreach t in array array['settings','tasks','habits','habit_logs','water_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
