import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ok } from '../lib/toast'
import { changed } from '../lib/gcal'
import { addDays, dayStr, startOfDay, startOfWeek, WEEKDAY_SHORT, WEEKDAYS_MON_FIRST } from '../lib/date'
import type { Habit, HabitLog } from '../lib/types'
import { TrashIcon } from '../components/Icons'

const HISTORY_DAYS = 90

function useHabits() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      supabase.from('habits').select('*').eq('archived', false).order('created_at'),
      supabase.from('habit_logs').select('id,habit_id,day').gte('day', dayStr(addDays(new Date(), -HISTORY_DAYS))),
    ])
    if (ok(h)) setHabits(h.data as Habit[])
    if (ok(l)) setLogs(l.data as HabitLog[])
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const done = useMemo(() => new Set(logs.map((l) => `${l.habit_id}|${l.day}`)), [logs])

  async function toggle(habit: Habit, day: string) {
    const existing = logs.find((l) => l.habit_id === habit.id && l.day === day)
    if (existing) {
      setLogs((ls) => ls.filter((l) => l.id !== existing.id))
      if (!ok(await supabase.from('habit_logs').delete().eq('id', existing.id))) load()
    } else {
      const res = await supabase.from('habit_logs').insert({ habit_id: habit.id, day }).select('id,habit_id,day').single()
      if (ok(res)) setLogs((ls) => [...ls, res.data as HabitLog])
    }
  }

  return { habits, done, loaded, load, toggle }
}

/** Consecutive scheduled days completed, counting back from today (today may still be open). */
function streak(h: Habit, done: Set<string>): number {
  let n = 0
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = addDays(startOfDay(), -i)
    if (!h.days.includes(d.getDay())) continue
    if (done.has(`${h.id}|${dayStr(d)}`)) n++
    else if (i > 0) break
  }
  return n
}

/** Habits scheduled for today, for the Today screen. */
export function TodayHabits() {
  const { habits, done, loaded, toggle } = useHabits()
  const today = dayStr()
  const due = habits.filter((h) => h.days.includes(new Date().getDay()))
  if (!loaded) return <p className="muted">Loading…</p>
  if (due.length === 0) return <p className="muted">No habits scheduled today.</p>
  return (
    <ul className="list">
      {due.map((h) => {
        const isDone = done.has(`${h.id}|${today}`)
        return (
          <li key={h.id} className={`item row ${isDone ? 'done' : ''}`}>
            <input type="checkbox" className="check" checked={isDone} onChange={() => toggle(h, today)} aria-label="Done" />
            <div className="grow title">{h.name}</div>
            <span className="small muted">{streak(h, done)} 🔥</span>
          </li>
        )
      })}
    </ul>
  )
}

export function HabitsPage() {
  const { habits, done, loaded, load, toggle } = useHabits()
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(), i))
  const todayStr = dayStr()

  async function archive(h: Habit) {
    if (!confirm(`Remove habit "${h.name}"? Its history is kept.`)) return
    if (ok(await supabase.from('habits').update({ archived: true, gcal_dirty: true }).eq('id', h.id))) {
      load()
      changed()
    }
  }

  async function setTime(h: Habit, time: string) {
    if (ok(await supabase.from('habits').update({ time: time || null, gcal_dirty: true }).eq('id', h.id))) {
      load()
      changed()
    }
  }

  return (
    <div className="stack">
      <HabitForm onAdded={load} />
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : habits.length === 0 ? (
        <p className="muted">No habits yet — add one like “Piano, Mon/Wed/Fri”.</p>
      ) : (
        <ul className="list">
          {habits.map((h) => (
            <li key={h.id} className="item stack">
              <div className="row">
                <div className="grow">
                  <div className="title">{h.name}</div>
                  <div className="small muted">
                    {h.days.length === 7 ? 'Every day' : WEEKDAYS_MON_FIRST.filter((d) => h.days.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(' · ')}
                    {h.time && ` at ${h.time}`}
                    {' — '}streak {streak(h, done)}
                  </div>
                </div>
                <input
                  type="time"
                  className="time-input"
                  defaultValue={h.time ?? ''}
                  onBlur={(e) => e.target.value !== (h.time ?? '') && setTime(h, e.target.value)}
                  aria-label="Reminder time"
                  title="Reminder time (Google Calendar)"
                />
                <button className="icon" onClick={() => archive(h)} aria-label="Remove"><TrashIcon /></button>
              </div>
              <div className="week">
                {week.map((d) => {
                  const ds = dayStr(d)
                  const scheduled = h.days.includes(d.getDay())
                  const isDone = done.has(`${h.id}|${ds}`)
                  const future = ds > todayStr
                  return (
                    <button
                      key={ds}
                      className={`day ${isDone ? 'on' : ''} ${scheduled ? '' : 'off'} ${ds === todayStr ? 'today' : ''}`}
                      disabled={future}
                      onClick={() => toggle(h, ds)}
                      aria-pressed={isDone}
                      aria-label={`${WEEKDAY_SHORT[d.getDay()]} ${ds}`}
                    >
                      <span>{WEEKDAY_SHORT[d.getDay()][0]}</span>
                      <span className="small">{d.getDate()}</span>
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function HabitForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [time, setTime] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || days.length === 0) return
    if (ok(await supabase.from('habits').insert({ name: name.trim(), days, time: time || null }))) {
      setName('')
      setDays([0, 1, 2, 3, 4, 5, 6])
      setTime('')
      onAdded()
      changed()
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <input placeholder="New habit, e.g. Piano 20 min" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="row wrap">
        {WEEKDAYS_MON_FIRST.map((d) => (
          <button
            type="button"
            key={d}
            className={`chip ${days.includes(d) ? 'on' : ''}`}
            onClick={() => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))}
            aria-pressed={days.includes(d)}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="grow">
          <span className="label">Reminder time (optional, goes to Google Calendar)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="primary" disabled={!name.trim() || days.length === 0}>Add</button>
      </div>
    </form>
  )
}
