-- Life Tracker – step 2: workouts + Google Calendar sync
-- Run once in Supabase: SQL Editor → New query → paste → Run.

-- Google Calendar bookkeeping on existing tables
alter table public.tasks
  add column if not exists gcal_event_id text,
  add column if not exists gcal_dirty boolean not null default true;

alter table public.habits
  add column if not exists time text,               -- 'HH:MM' local time, optional
  add column if not exists gcal_event_id text,
  add column if not exists gcal_dirty boolean not null default true;

create table if not exists public.exercises (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  category   text not null check (category in ('lifting','bouldering')),
  measure    text not null default 'reps' check (measure in ('reps','time')),
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- items: [{ "exercise_id": uuid, "sets": 3, "target": 8 }]  (target = reps or seconds)
create table if not exists public.routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  category   text not null check (category in ('lifting','bouldering')),
  items      jsonb not null default '[]',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  category      text not null check (category in ('lifting','bouldering')),
  routine_id    uuid references public.routines on delete set null,
  title         text not null,
  planned_at    timestamptz,
  duration_min  int not null default 60,
  started_at    timestamptz,
  finished_at   timestamptz,
  notes         text,
  top_grade     text,                               -- bouldering: hardest send (Fontainebleau)
  gcal_event_id text,
  gcal_dirty    boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.workout_sets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  workout_id  uuid not null references public.workouts on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  set_no      int not null,
  reps        int,
  weight_kg   numeric(6,2),
  duration_s  int,
  created_at  timestamptz not null default now()
);

-- Calendar events whose app item was deleted; removed from Google on next sync.
create table if not exists public.gcal_deletions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  event_id   text not null,
  created_at timestamptz not null default now()
);

create index if not exists workouts_planned_idx on public.workouts (user_id, planned_at);
create index if not exists workouts_started_idx on public.workouts (user_id, started_at);
create index if not exists sets_exercise_idx    on public.workout_sets (exercise_id, created_at);
create index if not exists sets_workout_idx     on public.workout_sets (workout_id);

do $$
declare t text;
begin
  foreach t in array array['exercises','routines','workouts','workout_sets','gcal_deletions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
