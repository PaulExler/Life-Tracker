import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { changed, forgetEvent } from '../../lib/gcal'
import { addDays, dayStr, fmtTime, startOfDay, startOfWeek, WEEKDAY_SHORT, WEEKDAYS_MON_FIRST } from '../../lib/date'
import { CATEGORY_ICON, fmtDuration, fmtSet, planWorkout, quickStart, startPlanned } from '../../lib/workouts'
import type { Exercise, Routine, Workout, WorkoutSet } from '../../lib/types'
import { TrashIcon } from '../../components/Icons'
import { RoutineOptions } from './WorkoutsPage'

const wDay = (w: Workout) => dayStr(new Date(w.started_at ?? w.planned_at!))

export function workoutStatus(w: Workout): 'done' | 'active' | 'missed' | 'planned' {
  if (w.finished_at) return 'done'
  if (w.started_at) return 'active'
  if (w.planned_at && new Date(w.planned_at) < startOfDay()) return 'missed'
  return 'planned'
}

export function WorkoutCalendar({ routines, exercises, onStarted }: { routines: Routine[]; exercises: Exercise[]; onStarted: () => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [sel, setSel] = useState(dayStr())
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [choice, setChoice] = useState('free:lifting')
  const [time, setTime] = useState('18:00')
  const [duration, setDuration] = useState('90')

  const gridStart = useMemo(() => startOfWeek(month), [month])
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])

  const load = useCallback(async () => {
    const a = gridStart.toISOString()
    const b = addDays(gridStart, 42).toISOString()
    const [p, s] = await Promise.all([
      supabase.from('workouts').select('*').gte('planned_at', a).lt('planned_at', b),
      supabase.from('workouts').select('*').is('planned_at', null).gte('started_at', a).lt('started_at', b),
    ])
    if (ok(p) && ok(s)) setWorkouts([...(p.data as Workout[]), ...(s.data as Workout[])])
  }, [gridStart])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (routines.length && choice.startsWith('free:')) setChoice(`r:${routines[0].id}`)
    // only when routines first arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routines.length])

  const byDay = useMemo(() => {
    const m = new Map<string, Workout[]>()
    for (const w of workouts) m.set(wDay(w), [...(m.get(wDay(w)) ?? []), w])
    m.forEach((v) => v.sort((a, b) => (a.started_at ?? a.planned_at!).localeCompare(b.started_at ?? b.planned_at!)))
    return m
  }, [workouts])

  const today = dayStr()
  const selWorkouts = byDay.get(sel) ?? []
  const selDate = new Date(`${sel}T00:00`)

  async function plan() {
    if (await planWorkout(choice, routines, new Date(`${sel}T${time}`), Number(duration) || 60)) load()
  }
  async function start(w: Workout) {
    if (await startPlanned(w)) onStarted()
  }
  async function remove(w: Workout) {
    if (!confirm(`Delete "${w.title}" on ${selDate.toLocaleDateString('en-GB')}?`)) return
    await forgetEvent(w.gcal_event_id)
    if (ok(await supabase.from('workouts').delete().eq('id', w.id))) {
      load()
      changed()
    }
  }

  return (
    <div className="stack">
      <div className="card row wrap">
        <select className="grow" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Workout type">
          <RoutineOptions routines={routines} />
        </select>
        <button className="primary" onClick={async () => (await quickStart(choice, routines)) && onStarted()}>
          Start now
        </button>
      </div>

      <div className="card stack">
        <div className="row">
          <button className="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
          <h3 className="grow center">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
          <button className="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
        </div>
        <div className="cal">
          {WEEKDAYS_MON_FIRST.map((d) => (
            <div key={d} className="cal-head small muted">{WEEKDAY_SHORT[d][0]}</div>
          ))}
          {cells.map((d) => {
            const ds = dayStr(d)
            const ws = byDay.get(ds) ?? []
            return (
              <button
                key={ds}
                className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${ds === today ? 'today' : ''} ${ds === sel ? 'sel' : ''}`}
                onClick={() => setSel(ds)}
              >
                <span>{d.getDate()}</span>
                <span className="dots">
                  {ws.slice(0, 3).map((w) => (
                    <i key={w.id} className={`dot ${w.category} ${workoutStatus(w)}`} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        <div className="row wrap small muted legend">
          <span><i className="dot lifting planned" /> planned</span>
          <span><i className="dot lifting done" /> lifting done</span>
          <span><i className="dot bouldering done" /> bouldering done</span>
          <span><i className="dot lifting missed" /> missed</span>
        </div>
      </div>

      <section className="stack">
        <h2>{selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        {selWorkouts.length > 0 && (
          <ul className="list">
            {selWorkouts.map((w) => (
              <WorkoutRow key={w.id} w={w} exercises={exercises} onStart={start} onRemove={remove} />
            ))}
          </ul>
        )}
        {sel >= today && (
          <div className="card stack">
            <div className="row wrap">
              <select className="grow" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Workout type">
                <RoutineOptions routines={routines} />
              </select>
            </div>
            <div className="row">
              <label className="grow">
                <span className="label">Time</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
              <label className="grow">
                <span className="label">Minutes</span>
                <input type="number" inputMode="numeric" min={10} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </label>
            </div>
            <button className="primary" onClick={plan}>Plan workout</button>
          </div>
        )}
      </section>
    </div>
  )
}

function WorkoutRow({
  w,
  exercises,
  onStart,
  onRemove,
}: {
  w: Workout
  exercises: Exercise[]
  onStart: (w: Workout) => void
  onRemove: (w: Workout) => void
}) {
  const [open, setOpen] = useState(false)
  const status = workoutStatus(w)
  const when = w.started_at ?? w.planned_at!
  return (
    <li className="item stack">
      <div className="row">
        <span className="emoji">{CATEGORY_ICON[w.category]}</span>
        <div className="grow">
          <div className="title">{w.title}</div>
          <div className="small muted">
            {fmtTime(when)}
            {status === 'done' && ` · ${fmtDuration(new Date(w.finished_at!).getTime() - new Date(w.started_at!).getTime())}`}
            {status === 'planned' && ` · ${w.duration_min} min planned`}
            {w.top_grade && ` · top ${w.top_grade}`}
          </div>
        </div>
        <span className={`badge ${status}`}>{status === 'active' ? 'in progress' : status}</span>
      </div>
      <div className="row end">
        {status === 'done' && <button className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'} sets</button>}
        {(status === 'planned' || status === 'missed') && <button className="primary" onClick={() => onStart(w)}>Start</button>}
        {status !== 'active' && <button className="icon" onClick={() => onRemove(w)} aria-label="Delete"><TrashIcon /></button>}
      </div>
      {open && <WorkoutSummary workout={w} exercises={exercises} />}
    </li>
  )
}

export function WorkoutSummary({ workout, exercises }: { workout: Workout; exercises: Exercise[] }) {
  const [sets, setSets] = useState<WorkoutSet[] | null>(null)
  useEffect(() => {
    supabase
      .from('workout_sets')
      .select('*')
      .eq('workout_id', workout.id)
      .order('created_at')
      .then((res) => ok(res) && setSets(res.data as WorkoutSet[]))
  }, [workout.id])
  if (!sets) return <p className="small muted">Loading…</p>
  if (sets.length === 0) return <p className="small muted">No sets logged.</p>
  const groups = new Map<string, WorkoutSet[]>()
  for (const s of sets) groups.set(s.exercise_id, [...(groups.get(s.exercise_id) ?? []), s])
  const volume = sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weight_kg ?? 0), 0)
  return (
    <div className="stack small">
      {[...groups].map(([exId, ss]) => {
        const ex = exercises.find((e) => e.id === exId)
        return (
          <div key={exId}>
            <strong>{ex?.name ?? 'Exercise'}</strong>
            <div className="muted">{ss.map((s) => fmtSet(ex?.measure ?? 'reps', s)).join(' · ')}</div>
          </div>
        )
      })}
      {volume > 0 && <div className="muted">Total volume: {Math.round(volume).toLocaleString('en-GB')} kg</div>}
      {workout.notes && <div className="pre">{workout.notes}</div>}
    </div>
  )
}
