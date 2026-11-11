import { supabase } from './supabase'
import { ok, toast } from './toast'
import { changed } from './gcal'
import type { Category, Exercise, Measure, Routine, Workout, WorkoutSet } from './types'

export const CATEGORY_LABEL: Record<Category, string> = { lifting: 'Weightlifting', bouldering: 'Bouldering' }
export const CATEGORY_ICON: Record<Category, string> = { lifting: '🏋️', bouldering: '🧗' }

export const FONT_GRADES = [
  '4', '5A', '5B', '5C', '6A', '6A+', '6B', '6B+', '6C', '6C+',
  '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C',
]

const DEFAULT_EXERCISES: { name: string; category: Category; measure: Measure }[] = [
  ...['Bench press', 'Incline dumbbell press', 'Overhead press', 'Squat', 'Deadlift', 'Romanian deadlift',
    'Leg press', 'Barbell row', 'Lat pulldown', 'Pull-up', 'Dips', 'Lateral raise', 'Biceps curl',
    'Triceps pushdown', 'Calf raise'].map((name) => ({ name, category: 'lifting' as const, measure: 'reps' as const })),
  { name: 'Hangboard – max hang', category: 'bouldering', measure: 'time' },
  { name: 'Hangboard – repeaters', category: 'bouldering', measure: 'time' },
  { name: 'Weighted pull-up', category: 'bouldering', measure: 'reps' },
  { name: 'Campus board ladders', category: 'bouldering', measure: 'reps' },
  { name: 'Hanging leg raise', category: 'bouldering', measure: 'reps' },
  { name: 'Front lever hold', category: 'bouldering', measure: 'time' },
  { name: 'Push-up', category: 'bouldering', measure: 'reps' },
  { name: 'Wrist roller', category: 'bouldering', measure: 'reps' },
]

/** All exercises (incl. archived, for history). Seeds a starter list on first use. */
export async function loadExercises(): Promise<Exercise[]> {
  let res = await supabase.from('exercises').select('*').order('name')
  if (!ok(res)) return []
  if (!res.data?.length) {
    await supabase.from('exercises').upsert(DEFAULT_EXERCISES, { onConflict: 'user_id,name', ignoreDuplicates: true })
    res = await supabase.from('exercises').select('*').order('name')
    if (!ok(res)) return []
  }
  return (res.data ?? []) as Exercise[]
}

export async function createExercise(name: string, category: Category, measure: Measure): Promise<Exercise | null> {
  const res = await supabase.from('exercises').insert({ name: name.trim(), category, measure }).select().single()
  return ok(res) ? (res.data as Exercise) : null
}

export async function loadRoutines(): Promise<Routine[]> {
  const res = await supabase.from('routines').select('*').eq('archived', false).order('name')
  return ok(res) ? (res.data as Routine[]) : []
}

export async function getActiveWorkout(): Promise<Workout | null> {
  const res = await supabase
    .from('workouts')
    .select('*')
    .not('started_at', 'is', null)
    .is('finished_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
  return ok(res) ? ((res.data?.[0] as Workout) ?? null) : null
}

/** Start a planned workout. Returns false if another one is already running. */
export async function startPlanned(w: Workout): Promise<boolean> {
  if (await getActiveWorkout()) {
    toast('Finish or discard the workout in progress first.')
    return false
  }
  return ok(await supabase.from('workouts').update({ started_at: new Date().toISOString() }).eq('id', w.id))
}

/** Start an unplanned workout right now. `choice` is "r:<routineId>" or "free:<category>". */
export async function quickStart(choice: string, routines: Routine[]): Promise<boolean> {
  if (await getActiveWorkout()) {
    toast('Finish or discard the workout in progress first.')
    return false
  }
  return ok(await supabase.from('workouts').insert({ ...fromChoice(choice, routines), started_at: new Date().toISOString(), gcal_dirty: false }))
}

export async function planWorkout(choice: string, routines: Routine[], plannedAt: Date, durationMin: number) {
  const res = await supabase
    .from('workouts')
    .insert({ ...fromChoice(choice, routines), planned_at: plannedAt.toISOString(), duration_min: durationMin })
  if (ok(res)) changed()
  return !res.error
}

export async function updatePlanned(w: Workout, choice: string, routines: Routine[], plannedAt: Date, durationMin: number) {
  const res = await supabase
    .from('workouts')
    .update({ ...fromChoice(choice, routines), planned_at: plannedAt.toISOString(), duration_min: durationMin, gcal_dirty: true })
    .eq('id', w.id)
  if (ok(res)) changed()
  return !res.error
}

/** Record a workout that already happened; returns it so its sets can be entered. */
export async function logPast(choice: string, routines: Routine[], start: Date, durationMin: number): Promise<Workout | null> {
  const res = await supabase
    .from('workouts')
    .insert({
      ...fromChoice(choice, routines),
      started_at: start.toISOString(),
      finished_at: new Date(start.getTime() + durationMin * 60000).toISOString(),
      duration_min: durationMin,
      gcal_dirty: false,
    })
    .select()
    .single()
  return ok(res) ? (res.data as Workout) : null
}

export const choiceOf =(w: Workout) => (w.routine_id ? `r:${w.routine_id}` : `free:${w.category}`)

function fromChoice(choice: string, routines: Routine[]) {
  if (choice.startsWith('r:')) {
    const r = routines.find((x) => x.id === choice.slice(2))
    if (r) return { category: r.category, routine_id: r.id, title: r.name }
  }
  const category = (choice.split(':')[1] as Category) || 'lifting'
  return { category, routine_id: null, title: CATEGORY_LABEL[category] }
}

/** Latest previous sets per exercise (from the most recent other workout that had them). */
export async function lastSets(exerciseIds: string[], excludeWorkoutId: string): Promise<Map<string, WorkoutSet[]>> {
  const out = new Map<string, WorkoutSet[]>()
  if (exerciseIds.length === 0) return out
  const res = await supabase
    .from('workout_sets')
    .select('*')
    .in('exercise_id', exerciseIds)
    .neq('workout_id', excludeWorkoutId)
    .order('created_at', { ascending: false })
    .limit(400)
  if (!ok(res)) return out
  const latestWorkout = new Map<string, string>()
  for (const s of res.data as WorkoutSet[]) {
    if (!latestWorkout.has(s.exercise_id)) latestWorkout.set(s.exercise_id, s.workout_id)
    if (latestWorkout.get(s.exercise_id) === s.workout_id) {
      out.set(s.exercise_id, [...(out.get(s.exercise_id) ?? []), s])
    }
  }
  out.forEach((v) => v.sort((a, b) => a.set_no - b.set_no))
  return out
}

/** Epley estimated one-rep max. */
export const e1rm = (kg: number, reps: number) => (reps > 0 ? kg * (1 + reps / 30) : 0)

export function fmtSet(measure: Measure, s: Pick<WorkoutSet, 'reps' | 'weight_kg' | 'duration_s'>) {
  const w = s.weight_kg ? `${+s.weight_kg}kg` : ''
  if (measure === 'time') return `${s.duration_s ?? 0}s${w ? ` +${w}` : ''}`
  return `${w || 'BW'} × ${s.reps ?? 0}`
}

export function fmtDuration(ms: number) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}
