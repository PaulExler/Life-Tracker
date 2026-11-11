import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { CATEGORY_ICON, CATEGORY_LABEL, createExercise } from '../../lib/workouts'
import type { Category, Exercise, Measure, Routine, RoutineItem } from '../../lib/types'
import { EditIcon, TrashIcon } from '../../components/Icons'

export function RoutinesView({
  routines,
  exercises,
  onChanged,
  onExercisesChanged,
}: {
  routines: Routine[]
  exercises: Exercise[]
  onChanged: () => void
  onExercisesChanged: () => Promise<unknown>
}) {
  const [editing, setEditing] = useState<Routine | 'new' | null>(null)
  const exName = (id: string) => exercises.find((e) => e.id === id)

  async function remove(r: Routine) {
    if (!confirm(`Delete routine "${r.name}"? Past workouts are kept.`)) return
    if (ok(await supabase.from('routines').update({ archived: true }).eq('id', r.id))) onChanged()
  }

  if (editing)
    return (
      <RoutineEditor
        routine={editing === 'new' ? null : editing}
        exercises={exercises}
        onExercisesChanged={onExercisesChanged}
        onDone={() => {
          setEditing(null)
          onChanged()
        }}
      />
    )

  return (
    <div className="stack">
      <button className="primary" onClick={() => setEditing('new')}>+ New routine</button>
      {routines.length === 0 ? (
        <p className="muted">No routines yet. Create e.g. “Push”, “Pull”, “Legs” or “Hangboard session”.</p>
      ) : (
        <ul className="list">
          {routines.map((r) => (
            <li key={r.id} className="item row">
              <span className="emoji">{CATEGORY_ICON[r.category]}</span>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="small muted">
                  {r.items
                    .map((i) => {
                      const e = exName(i.exercise_id)
                      return e ? `${e.name} ${i.sets}×${i.target ?? '?'}${e.measure === 'time' ? 's' : ''}` : null
                    })
                    .filter(Boolean)
                    .join(' · ') || 'No exercises'}
                </div>
              </div>
              <button className="icon" onClick={() => setEditing(r)} aria-label="Edit"><EditIcon /></button>
              <button className="icon" onClick={() => remove(r)} aria-label="Delete"><TrashIcon /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RoutineEditor({
  routine,
  exercises,
  onExercisesChanged,
  onDone,
}: {
  routine: Routine | null
  exercises: Exercise[]
  onExercisesChanged: () => Promise<unknown>
  onDone: () => void
}) {
  const [name, setName] = useState(routine?.name ?? '')
  const [category, setCategory] = useState<Category>(routine?.category ?? 'lifting')
  const [items, setItems] = useState<RoutineItem[]>(routine?.items ?? [])
  const [newName, setNewName] = useState('')
  const [newMeasure, setNewMeasure] = useState<Measure>('reps')
  const exMap = new Map(exercises.map((e) => [e.id, e]))
  const available = exercises.filter((e) => !e.archived && !items.some((i) => i.exercise_id === e.id))
  const sorted = [...available].sort((a, b) => Number(b.category === category) - Number(a.category === category))

  const setItem = (i: number, patch: Partial<RoutineItem>) => setItems((it) => it.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) =>
    setItems((it) => {
      const j = i + d
      if (j < 0 || j >= it.length) return it
      const c = [...it]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })
  const add = (id: string) => {
    const e = exMap.get(id)
    if (e) setItems((it) => [...it, { exercise_id: id, sets: 3, target: e.measure === 'time' ? 10 : 8 }])
  }

  async function createAndAdd() {
    const ex = await createExercise(newName, category, newMeasure)
    if (!ex) return
    await onExercisesChanged()
    setItems((it) => [...it, { exercise_id: ex.id, sets: 3, target: ex.measure === 'time' ? 10 : 8 }])
    setNewName('')
  }

  async function save() {
    const row = { name: name.trim(), category, items }
    const res = routine
      ? await supabase.from('routines').update(row).eq('id', routine.id)
      : await supabase.from('routines').insert(row)
    if (ok(res)) onDone()
  }

  return (
    <div className="stack">
      <div className="card stack">
        <input placeholder="Routine name, e.g. Push day" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          {(['lifting', 'bouldering'] as Category[]).map((c) => (
            <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)} aria-pressed={category === c}>
              {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {items.length > 0 && (
        <ul className="list">
          {items.map((it, i) => {
            const e = exMap.get(it.exercise_id)
            return (
              <li key={it.exercise_id} className="item stack">
                <div className="row">
                  <div className="grow title">{e?.name ?? 'Unknown exercise'}</div>
                  <button className="icon" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="icon" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="icon" onClick={() => setItems((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><TrashIcon /></button>
                </div>
                <div className="row">
                  <label className="grow">
                    <span className="label">Sets</span>
                    <input type="number" inputMode="numeric" min={1} value={it.sets} onChange={(ev) => setItem(i, { sets: Math.max(1, Number(ev.target.value) || 1) })} />
                  </label>
                  <label className="grow">
                    <span className="label">Target {e?.measure === 'time' ? 'seconds' : 'reps'}</span>
                    <input type="number" inputMode="numeric" min={1} value={it.target ?? ''} onChange={(ev) => setItem(i, { target: ev.target.value ? Number(ev.target.value) : null })} />
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="card stack">
        <select value="" onChange={(e) => add(e.target.value)} aria-label="Add exercise">
          <option value="">+ Add exercise…</option>
          {sorted.map((e) => (
            <option key={e.id} value={e.id}>{CATEGORY_ICON[e.category]} {e.name}</option>
          ))}
        </select>
        <div className="row wrap">
          <input className="grow" placeholder="…or create a new exercise" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select value={newMeasure} onChange={(e) => setNewMeasure(e.target.value as Measure)} aria-label="Measured in">
            <option value="reps">Reps</option>
            <option value="time">Seconds</option>
          </select>
          <button disabled={!newName.trim()} onClick={createAndAdd}>Create</button>
        </div>
      </div>

      <div className="row end">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={save}>Save routine</button>
      </div>
    </div>
  )
}
