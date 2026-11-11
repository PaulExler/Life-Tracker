import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { addDays, startOfWeek } from '../../lib/date'
import { e1rm, fmtSet } from '../../lib/workouts'
import type { Exercise, Workout, WorkoutSet } from '../../lib/types'

const WEEKS = 10

export function ProgressView({ exercises }: { exercises: Exercise[] }) {
  const [weeks, setWeeks] = useState<{ start: Date; lifting: number; bouldering: number }[]>([])
  const [exId, setExId] = useState('')

  useEffect(() => {
    const from = addDays(startOfWeek(), -7 * (WEEKS - 1))
    supabase
      .from('workouts')
      .select('category,finished_at')
      .gte('finished_at', from.toISOString())
      .then((res) => {
        if (!ok(res)) return
        const ws = Array.from({ length: WEEKS }, (_, i) => ({ start: addDays(from, 7 * i), lifting: 0, bouldering: 0 }))
        for (const w of res.data as Pick<Workout, 'category' | 'finished_at'>[]) {
          const i = Math.floor((new Date(w.finished_at!).getTime() - from.getTime()) / (7 * 86_400_000))
          if (ws[i]) ws[i][w.category]++
        }
        setWeeks(ws)
      })
  }, [])

  const max = Math.max(1, ...weeks.map((w) => w.lifting + w.bouldering))
  const active = exercises.filter((e) => !e.archived)

  return (
    <div className="stack">
      <section className="card stack">
        <h3>Workouts per week</h3>
        <div className="chart wide">
          {weeks.map((w) => (
            <div key={w.start.toISOString()} className="col">
              <span className="small muted">{w.lifting + w.bouldering || ''}</span>
              <div className="track stacked">
                <div className="fill bouldering" style={{ height: `${(w.bouldering / max) * 100}%` }} />
                <div className="fill lifting" style={{ height: `${(w.lifting / max) * 100}%` }} />
              </div>
              <span className="small muted">{w.start.getDate()}.{w.start.getMonth() + 1}</span>
            </div>
          ))}
        </div>
        <div className="row small muted legend">
          <span><i className="dot lifting done" /> lifting</span>
          <span><i className="dot bouldering done" /> bouldering</span>
        </div>
      </section>

      <section className="card stack">
        <h3>Exercise progress</h3>
        <select value={exId} onChange={(e) => setExId(e.target.value)} aria-label="Exercise">
          <option value="">Choose an exercise…</option>
          {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {exId && <ExerciseChart exercise={exercises.find((e) => e.id === exId)!} />}
      </section>
    </div>
  )
}

type Row = WorkoutSet & { workouts: { finished_at: string | null } }

function ExerciseChart({ exercise }: { exercise: Exercise }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    setRows(null)
    supabase
      .from('workout_sets')
      .select('*, workouts!inner(finished_at)')
      .eq('exercise_id', exercise.id)
      .not('workouts.finished_at', 'is', null)
      .order('created_at')
      .then((res) => ok(res) && setRows(res.data as Row[]))
  }, [exercise.id])

  const time = exercise.measure === 'time'
  const sessions = useMemo(() => {
    const m = new Map<string, { date: Date; sets: Row[] }>()
    for (const r of rows ?? []) {
      const s = m.get(r.workout_id) ?? { date: new Date(r.workouts.finished_at!), sets: [] }
      s.sets.push(r)
      m.set(r.workout_id, s)
    }
    return [...m.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((s) => ({
        ...s,
        // Strength: best estimated 1RM. Holds: longest hang.
        value: Math.max(...s.sets.map((x) => (time ? (x.duration_s ?? 0) : e1rm(Number(x.weight_kg ?? 0), x.reps ?? 0)))),
        maxKg: Math.max(...s.sets.map((x) => Number(x.weight_kg ?? 0))),
      }))
  }, [rows, time])

  if (!rows) return <p className="small muted">Loading…</p>
  if (sessions.length === 0) return <p className="small muted">No finished workouts with this exercise yet.</p>

  const W = 320, H = 140, P = 24
  const vals = sessions.map((s) => s.value)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const pts = sessions.map((s, i) => [
    P + (sessions.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (sessions.length - 1)),
    H - P - ((s.value - lo) / span) * (H - 2 * P),
  ])
  const unit = time ? 's' : 'kg'
  const best = sessions.reduce((a, b) => (b.value > a.value ? b : a))

  return (
    <div className="stack">
      <div className="small muted">
        {time ? 'Longest hold per session' : 'Estimated 1-rep max per session (best set)'} · best {Math.round(best.value * 10) / 10}
        {unit} on {best.date.toLocaleDateString('en-GB')}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" role="img" aria-label="Progress chart">
        <text x={2} y={P} className="axis">{Math.round(hi)}{unit}</text>
        <text x={2} y={H - P + 4} className="axis">{Math.round(lo)}{unit}</text>
        <polyline points={pts.map((p) => p.join(',')).join(' ')} />
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.5} />)}
      </svg>
      <ul className="list compact">
        {sessions.slice(-5).reverse().map((s) => (
          <li key={s.date.toISOString()} className="item">
            <div className="small"><strong>{s.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</strong></div>
            <div className="small muted">{s.sets.map((x) => fmtSet(exercise.measure, x)).join(' · ')}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
