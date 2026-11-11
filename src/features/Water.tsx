import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ok } from '../lib/toast'
import { addDays, dayStr, fmtTime, startOfDay, WEEKDAY_SHORT } from '../lib/date'
import { useSettings } from '../lib/settings'
import type { WaterLog } from '../lib/types'
import { EditIcon, TrashIcon } from '../components/Icons'

const QUICK = [250, 330, 500]

export function WaterCard({ onChange, showEntries = false }: { onChange?: () => void; showEntries?: boolean }) {
  const { settings } = useSettings()
  const goal = settings?.water_goal_ml ?? 2500
  const [logs, setLogs] = useState<WaterLog[]>([])
  const [custom, setCustom] = useState('')

  const load = useCallback(async () => {
    const res = await supabase
      .from('water_logs')
      .select('*')
      .gte('logged_at', startOfDay().toISOString())
      .order('logged_at', { ascending: false })
    if (ok(res)) setLogs(res.data as WaterLog[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function add(ml: number) {
    if (!(ml > 0)) return
    const res = await supabase.from('water_logs').insert({ amount_ml: Math.round(ml) }).select().single()
    if (ok(res)) {
      setLogs((l) => [res.data as WaterLog, ...l])
      onChange?.()
    }
  }

  async function remove(id: string) {
    setLogs((l) => l.filter((x) => x.id !== id))
    if (ok(await supabase.from('water_logs').delete().eq('id', id))) onChange?.()
    else load()
  }

  const total = logs.reduce((s, l) => s + l.amount_ml, 0)
  const pct = Math.min(100, (total / goal) * 100)

  return (
    <div className="card stack">
      <div className="row baseline">
        <span className="big">{(total / 1000).toFixed(2)} L</span>
        <span className="muted grow">of {(goal / 1000).toFixed(1)} L</span>
        {total >= goal && <span className="badge">Goal reached</span>}
      </div>
      <div className="bar water"><div style={{ width: `${pct}%` }} /></div>
      <div className="row wrap">
        {QUICK.map((ml) => (
          <button key={ml} className="chip on" onClick={() => add(ml)}>+{ml} ml</button>
        ))}
        <form
          className="row grow"
          onSubmit={(e) => {
            e.preventDefault()
            add(Number(custom))
            setCustom('')
          }}
        >
          <input className="grow" type="number" inputMode="numeric" min={1} placeholder="ml" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button disabled={!(Number(custom) > 0)}>Add</button>
        </form>
      </div>
      {showEntries && logs.length > 0 && (
        <ul className="list compact">
          {logs.map((l) => (
            <WaterRow key={l.id} log={l} onRemove={() => remove(l.id)} onSaved={(n) => {
              setLogs((ls) => ls.map((x) => (x.id === n.id ? n : x)).sort((a, b) => b.logged_at.localeCompare(a.logged_at)))
              onChange?.()
            }} />
          ))}
        </ul>
      )}
    </div>
  )
}

function WaterRow({ log: l, onRemove, onSaved }: { log: WaterLog; onRemove: () => void; onSaved: (l: WaterLog) => void }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(l.amount_ml))
  const [time, setTime] = useState(fmtTime(l.logged_at))

  async function save() {
    const ml = Math.round(Number(amount))
    if (!(ml > 0)) return
    const d = new Date(l.logged_at)
    const [hh, mm] = time.split(':').map(Number)
    if (!Number.isNaN(hh)) d.setHours(hh, mm || 0, 0, 0)
    const res = await supabase.from('water_logs').update({ amount_ml: ml, logged_at: d.toISOString() }).eq('id', l.id).select().single()
    if (ok(res) && res.data) {
      onSaved(res.data as WaterLog)
      setEditing(false)
    }
  }

  if (editing)
    return (
      <li className="item row">
        <input type="time" className="time-input" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
        <input className="grow" type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount ml" />
        <button onClick={() => setEditing(false)}>Cancel</button>
        <button className="primary" onClick={save}>Save</button>
      </li>
    )
  return (
    <li className="item row">
      <span className="muted">{fmtTime(l.logged_at)}</span>
      <span className="grow">{l.amount_ml} ml</span>
      <button className="icon" onClick={() => setEditing(true)} aria-label="Edit"><EditIcon /></button>
      <button className="icon" onClick={onRemove} aria-label="Delete"><TrashIcon /></button>
    </li>
  )
}

export function WaterPage() {
  const { settings } = useSettings()
  const goal = settings?.water_goal_ml ?? 2500
  const [totals, setTotals] = useState<{ day: Date; ml: number }[]>([])

  const load = useCallback(async () => {
    const from = addDays(startOfDay(), -6)
    const res = await supabase.from('water_logs').select('amount_ml,logged_at').gte('logged_at', from.toISOString())
    if (!ok(res)) return
    const byDay = new Map<string, number>()
    for (const r of res.data as WaterLog[]) {
      const k = dayStr(new Date(r.logged_at))
      byDay.set(k, (byDay.get(k) ?? 0) + r.amount_ml)
    }
    setTotals(Array.from({ length: 7 }, (_, i) => {
      const day = addDays(from, i)
      return { day, ml: byDay.get(dayStr(day)) ?? 0 }
    }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const max = Math.max(goal, ...totals.map((t) => t.ml))

  return (
    <div className="stack">
      <WaterCard onChange={load} showEntries />
      <section className="card stack">
        <h3>Last 7 days</h3>
        <div className="chart">
          {totals.map((t) => (
            <div key={t.day.toISOString()} className="col">
              <span className="small muted">{t.ml ? (t.ml / 1000).toFixed(1) : ''}</span>
              <div className="track">
                <div className={`fill ${t.ml >= goal ? 'met' : ''}`} style={{ height: `${(t.ml / max) * 100}%` }} />
                <div className="goal" style={{ bottom: `${(goal / max) * 100}%` }} />
              </div>
              <span className="small">{WEEKDAY_SHORT[t.day.getDay()]}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
