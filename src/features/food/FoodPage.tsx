import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { addDays, dayStr, fmtTime, startOfDay } from '../../lib/date'
import { defaultMeal, MEAL_LABEL, MEALS } from '../../lib/food'
import { useSettings } from '../../lib/settings'
import type { FoodLog, Meal } from '../../lib/types'
import { EditIcon, TrashIcon } from '../../components/Icons'
import { WaterPage } from '../Water'
import { AnalyzeAdd, MealPicker, QuickAdd, SearchAdd } from './AddPanels'

type Mode = 'quick' | 'search' | 'photo' | 'recipe'
const MODES: { id: Mode; label: string }[] = [
  { id: 'search', label: '🔎 Search' },
  { id: 'photo', label: '📷 Photo' },
  { id: 'recipe', label: '📝 Recipe' },
  { id: 'quick', label: '✏️ Quick' },
]

export async function loadDayLogs(day: Date): Promise<FoodLog[]> {
  const res = await supabase
    .from('food_logs')
    .select('*')
    .gte('logged_at', startOfDay(day).toISOString())
    .lt('logged_at', addDays(startOfDay(day), 1).toISOString())
    .order('logged_at')
  return ok(res) ? (res.data as FoodLog[]) : []
}

export function FoodPage() {
  const [day, setDay] = useState(startOfDay())
  const [logs, setLogs] = useState<FoodLog[] | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [meal, setMeal] = useState<Meal>(defaultMeal())
  const isToday = dayStr(day) === dayStr()

  const load = useCallback(async () => setLogs(await loadDayLogs(day)), [day])
  useEffect(() => {
    setLogs(null)
    load()
  }, [load])

  const panelProps = {
    day,
    meal,
    setMeal,
    onAdded: () => {
      setMode(null)
      load()
    },
  }

  return (
    <div className="stack">
      <div className="row day-nav">
        <button className="icon" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</button>
        <h3 className="grow center">
          {isToday ? 'Today' : day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
        </h3>
        <button className="icon" onClick={() => setDay(addDays(day, 1))} disabled={isToday} aria-label="Next day">›</button>
      </div>

      <CalorieSummary logs={logs ?? []} />

      <div className="segmented" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(mode === m.id ? null : m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'quick' && <QuickAdd {...panelProps} />}
      {mode === 'search' && <SearchAdd {...panelProps} />}
      {(mode === 'photo' || mode === 'recipe') && <AnalyzeAdd key={mode} mode={mode} {...panelProps} />}

      {!logs ? (
        <p className="muted">Loading…</p>
      ) : (
        MEALS.map((m) => {
          const items = logs.filter((l) => l.meal === m)
          if (items.length === 0) return null
          const sum = items.reduce((s, l) => s + Number(l.kcal), 0)
          return (
            <section key={m} className="stack">
              <h2>{MEAL_LABEL[m]} · {Math.round(sum)} kcal</h2>
              <ul className="list">
                {items.map((l) => <LogRow key={l.id} log={l} onChanged={load} />)}
              </ul>
            </section>
          )
        })
      )}
      {logs && logs.length === 0 && !mode && <p className="muted">Nothing logged {isToday ? 'yet today' : 'on this day'}.</p>}

      {isToday && (
        <section className="stack">
          <h2>Water</h2>
          <WaterPage />
        </section>
      )}
    </div>
  )
}

export function CalorieSummary({ logs, compact = false }: { logs: FoodLog[]; compact?: boolean }) {
  const { settings } = useSettings()
  const goal = settings?.calorie_goal ?? 2500
  const pGoal = settings?.protein_goal_g ?? null
  const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g') => logs.reduce((s, l) => s + Number(l[k] ?? 0), 0)
  const kcal = Math.round(sum('kcal'))
  const left = goal - kcal
  return (
    <div className="card stack">
      <div className="row baseline">
        <span className="big">{kcal}</span>
        <span className="muted grow">/ {goal} kcal</span>
        <span className={`small ${left < 0 ? 'danger' : 'muted'}`}>{left >= 0 ? `${left} left` : `${-left} over`}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.min(100, (kcal / goal) * 100)}%`, background: left < 0 ? 'var(--danger)' : undefined }} /></div>
      {!compact && (
        <div className="macro-row">
          <span>Protein {Math.round(sum('protein_g'))}{pGoal ? ` / ${pGoal}` : ''} g</span>
          <span>Carbs {Math.round(sum('carbs_g'))} g</span>
          <span>Fat {Math.round(sum('fat_g'))} g</span>
        </div>
      )}
    </div>
  )
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const str = (v: number | null | undefined) => (v == null ? '' : String(+v))

function LogRow({ log: l, onChanged }: { log: FoodLog; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(l.name)
  const [meal, setMeal] = useState<Meal>(l.meal)
  const [time, setTime] = useState(fmtTime(l.logged_at))
  const [grams, setGrams] = useState(str(l.grams))
  const [kcal, setKcal] = useState(str(l.kcal))
  const [p, setP] = useState(str(l.protein_g))
  const [c, setC] = useState(str(l.carbs_g))
  const [f, setF] = useState(str(l.fat_g))

  /** Changing the weight scales calories and macros proportionally. */
  function onGrams(v: string) {
    setGrams(v)
    const old = Number(l.grams)
    const g = num(v)
    if (old > 0 && g && g > 0) {
      const k = g / old
      const s = (x: number | null) => (x == null ? '' : String(Math.round(x * k * 10) / 10))
      setKcal(String(Math.round(Number(l.kcal) * k)))
      setP(s(l.protein_g)); setC(s(l.carbs_g)); setF(s(l.fat_g))
    }
  }

  async function save() {
    const d = new Date(l.logged_at)
    const [hh, mm] = time.split(':').map(Number)
    if (!Number.isNaN(hh)) d.setHours(hh, mm || 0, 0, 0)
    const k = Number(l.grams) > 0 && num(grams) ? Number(num(grams)) / Number(l.grams) : 1
    const res = await supabase
      .from('food_logs')
      .update({
        name: name.trim() || l.name, meal, logged_at: d.toISOString(), grams: num(grams), kcal: num(kcal) ?? l.kcal,
        protein_g: num(p), carbs_g: num(c), fat_g: num(f),
        kcal_low: l.kcal_low == null ? null : Math.round(l.kcal_low * k),
        kcal_high: l.kcal_high == null ? null : Math.round(l.kcal_high * k),
      })
      .eq('id', l.id)
    if (ok(res)) {
      setEditing(false)
      onChanged()
    }
  }

  async function remove() {
    if (!confirm(`Delete "${l.name}"?`)) return
    if (ok(await supabase.from('food_logs').delete().eq('id', l.id))) onChanged()
  }

  if (editing)
    return (
      <li className="item stack">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <div className="row">
          <label className="grow"><span className="label">Time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <label className="grow"><span className="label">Grams</span><input inputMode="decimal" value={grams} onChange={(e) => onGrams(e.target.value)} /></label>
          <label className="grow"><span className="label">kcal</span><input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        </div>
        <div className="row">
          <label className="grow"><span className="label">Protein g</span><input inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></label>
          <label className="grow"><span className="label">Carbs g</span><input inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></label>
          <label className="grow"><span className="label">Fat g</span><input inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} /></label>
        </div>
        <MealPicker meal={meal} onChange={setMeal} />
        <div className="row">
          <button className="danger-btn" onClick={remove}>Delete</button>
          <button className="push" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </li>
    )

  return (
    <li className="item stack">
      <div className="row">
        <div className="grow clickable" onClick={() => l.details && setOpen((o) => !o)}>
          <div className="title">{l.source === 'photo' ? '📷 ' : l.source === 'recipe' ? '📝 ' : ''}{l.name}</div>
          <div className="small muted">
            {fmtTime(l.logged_at)}
            {l.grams ? ` · ${+l.grams} g` : ''}
            {l.protein_g != null ? ` · P ${Math.round(l.protein_g)} C ${Math.round(l.carbs_g ?? 0)} F ${Math.round(l.fat_g ?? 0)}` : ''}
            {l.kcal_low != null && l.kcal_high != null ? ` · ${Math.round(l.kcal_low)}–${Math.round(l.kcal_high)}` : ''}
          </div>
        </div>
        <strong>{Math.round(l.kcal)}</strong>
        <button className="icon" onClick={() => setEditing(true)} aria-label="Edit"><EditIcon /></button>
        <button className="icon" onClick={remove} aria-label="Delete"><TrashIcon /></button>
      </div>
      {open && l.details && (
        <div className="small muted stack">
          {l.details.items.map((it, i) => (
            <div key={i} className="row"><span className="grow">{it.name}</span><span>{Math.round(it.grams)} g · {Math.round(it.kcal)} kcal</span></div>
          ))}
          {l.details.notes && <div>{l.details.notes}</div>}
        </div>
      )}
    </li>
  )
}

/** Compact calorie card for the Today screen. */
export function TodayCalories() {
  const [logs, setLogs] = useState<FoodLog[]>([])
  useEffect(() => {
    loadDayLogs(new Date()).then(setLogs)
  }, [])
  return (
    <a href="#food" className="plain-link">
      <CalorieSummary logs={logs} />
    </a>
  )
}
