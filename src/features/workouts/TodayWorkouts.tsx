import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { addDays, fmtTime, startOfDay } from '../../lib/date'
import { CATEGORY_ICON, startPlanned } from '../../lib/workouts'
import type { Workout } from '../../lib/types'
import { workoutStatus } from './Calendar'

/** Today's planned / running / finished workouts on the Today screen. */
export function TodayWorkouts() {
  const [list, setList] = useState<Workout[] | null>(null)

  useEffect(() => {
    const a = startOfDay().toISOString()
    const b = addDays(startOfDay(), 1).toISOString()
    Promise.all([
      supabase.from('workouts').select('*').gte('planned_at', a).lt('planned_at', b),
      supabase.from('workouts').select('*').not('started_at', 'is', null).is('finished_at', null),
    ]).then(([p, r]) => {
      if (!ok(p) || !ok(r)) return setList([])
      const all = new Map<string, Workout>()
      for (const w of [...(r.data as Workout[]), ...(p.data as Workout[])]) all.set(w.id, w)
      setList([...all.values()])
    })
  }, [])

  if (!list) return <p className="muted">Loading…</p>
  if (list.length === 0)
    return (
      <p className="muted">
        Rest day. <a href="#workouts">Plan or start a workout</a>
      </p>
    )
  return (
    <ul className="list">
      {list.map((w) => {
        const st = workoutStatus(w)
        return (
          <li key={w.id} className="item row">
            <span className="emoji">{CATEGORY_ICON[w.category]}</span>
            <div className="grow">
              <div className="title">{w.title}</div>
              <div className="small muted">{fmtTime(w.planned_at ?? w.started_at!)}</div>
            </div>
            {st === 'planned' && (
              <button className="primary" onClick={async () => (await startPlanned(w)) && (location.hash = '#workouts')}>Start</button>
            )}
            {st === 'active' && <a className="badge active" href="#workouts">in progress →</a>}
            {st === 'done' && <span className="badge done">done</span>}
          </li>
        )
      })}
    </ul>
  )
}
