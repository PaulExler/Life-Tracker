import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok, toast } from '../../lib/toast'
import { CATEGORY_ICON, CATEGORY_LABEL, createExercise, loadExercises } from '../../lib/workouts'
import type { Category, Exercise, Measure } from '../../lib/types'
import { EditIcon } from '../../components/Icons'

/** Settings → Exercises: rename, re-categorise, hide/restore, add. */
export function ExerciseSettings() {
  const [open, setOpen] = useState(false)
  const [exercises, setExercises] = useState<Exercise[] | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState<Category>('lifting')
  const [newMeasure, setNewMeasure] = useState<Measure>('reps')

  const reload = () => loadExercises().then(setExercises)
  useEffect(() => {
    if (open && !exercises) reload()
  }, [open, exercises])

  async function add() {
    if (!newName.trim()) return
    if (await createExercise(newName, newCat, newMeasure)) {
      setNewName('')
      reload()
    }
  }

  if (!open)
    return (
      <div className="card row">
        <div className="grow">
          <h3>Exercises</h3>
          <div className="small muted">Rename, fix spelling, hide or add exercises.</div>
        </div>
        <button onClick={() => setOpen(true)}>Manage</button>
      </div>
    )

  const hiddenCount = exercises?.filter((e) => e.archived).length ?? 0
  const visible = (exercises ?? []).filter((e) => showHidden || !e.archived)

  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow">Exercises</h3>
        <button className="link" onClick={() => setOpen(false)}>Close</button>
      </div>
      {!exercises ? (
        <p className="small muted">Loading…</p>
      ) : (
        (['lifting', 'bouldering'] as Category[]).map((cat) => (
          <div key={cat} className="stack">
            <h2>{CATEGORY_ICON[cat]} {CATEGORY_LABEL[cat]}</h2>
            <ul className="list">
              {visible
                .filter((e) => e.category === cat)
                .map((e) => (
                  <ExerciseRow key={e.id} ex={e} onChanged={reload} />
                ))}
            </ul>
          </div>
        ))
      )}
      {hiddenCount > 0 && (
        <button className="link" onClick={() => setShowHidden((s) => !s)}>
          {showHidden ? 'Hide' : 'Show'} hidden exercises ({hiddenCount})
        </button>
      )}
      <div className="stack">
        <h2>Add exercise</h2>
        <input placeholder="Exercise name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <div className="row">
          <select className="grow" value={newCat} onChange={(e) => setNewCat(e.target.value as Category)} aria-label="Category">
            <option value="lifting">Weightlifting</option>
            <option value="bouldering">Bouldering</option>
          </select>
          <select className="grow" value={newMeasure} onChange={(e) => setNewMeasure(e.target.value as Measure)} aria-label="Measured in">
            <option value="reps">Reps</option>
            <option value="time">Seconds</option>
          </select>
          <button className="primary" disabled={!newName.trim()} onClick={add}>Add</button>
        </div>
      </div>
    </div>
  )
}

function ExerciseRow({ ex, onChanged }: { ex: Exercise; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(ex.name)
  const [cat, setCat] = useState<Category>(ex.category)

  async function save() {
    if (!name.trim()) return
    if (ok(await supabase.from('exercises').update({ name: name.trim(), category: cat }).eq('id', ex.id))) {
      setEditing(false)
      onChanged()
    }
  }

  async function setHidden(archived: boolean) {
    if (ok(await supabase.from('exercises').update({ archived }).eq('id', ex.id))) {
      toast(archived ? `"${ex.name}" hidden — history is kept.` : `"${ex.name}" is back.`)
      onChanged()
    }
  }

  if (editing)
    return (
      <li className="item stack">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Exercise name" autoFocus />
        <div className="row">
          <select className="grow" value={cat} onChange={(e) => setCat(e.target.value as Category)} aria-label="Category">
            <option value="lifting">Weightlifting</option>
            <option value="bouldering">Bouldering</option>
          </select>
          <span className="small muted">{ex.measure === 'time' ? 'seconds' : 'reps'}</span>
        </div>
        <div className="row">
          <button className="danger-btn" onClick={() => setHidden(true)}>Hide</button>
          <button className="push" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={save}>Save</button>
        </div>
      </li>
    )

  return (
    <li className={`item row ${ex.archived ? 'done' : ''}`}>
      <div className="grow">
        <div className="title">{ex.name}</div>
        <div className="small muted">{ex.measure === 'time' ? 'seconds (+kg)' : 'reps × kg'}{ex.archived && ' · hidden'}</div>
      </div>
      {ex.archived ? (
        <button className="link" onClick={() => setHidden(false)}>Show again</button>
      ) : (
        <button className="icon" onClick={() => setEditing(true)} aria-label={`Edit ${ex.name}`}><EditIcon /></button>
      )}
    </li>
  )
}
