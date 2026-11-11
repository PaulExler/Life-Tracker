import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { changed } from '../../lib/gcal'
import { CATEGORY_ICON, createExercise, FONT_GRADES, fmtSet, lastSets } from '../../lib/workouts'
import type { Exercise, Measure, Routine, Workout, WorkoutSet } from '../../lib/types'
import { TrashIcon } from '../../components/Icons'

interface Draft {
  key: string
  id?: string
  weight: string
  amount: string // reps or seconds
  saved: boolean
  dirty: boolean
}
interface Block {
  exercise_id: string
  target: number | null
  last: WorkoutSet[]
  sets: Draft[]
}

let keySeq = 0
const k = () => `d${++keySeq}`
const str = (n: number | null | undefined) => (n == null ? '' : String(+n))
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

function draftsFromLast(n: number, last: WorkoutSet[], measure: Measure, target: number | null): Draft[] {
  return Array.from({ length: n }, (_, i) => {
    const l = last[i] ?? last[last.length - 1]
    return {
      key: k(),
      weight: str(l?.weight_kg),
      amount: str(measure === 'time' ? (l?.duration_s ?? target) : (l?.reps ?? target)),
      saved: false,
      dirty: false,
    }
  })
}

export function ActiveWorkout({
  workout: w,
  exercises,
  routines,
  onExercisesChanged,
  onClose,
}: {
  workout: Workout
  exercises: Exercise[]
  routines: Routine[]
  onExercisesChanged: () => Promise<unknown>
  onClose: () => void
}) {
  const exMap = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises])
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [notes, setNotes] = useState(w.notes ?? '')
  const [grade, setGrade] = useState(w.top_grade ?? '')
  const [now, setNow] = useState(Date.now())
  const [lastLogged, setLastLogged] = useState<number | null>(null)
  const [adding, setAdding] = useState('')
  const [newName, setNewName] = useState('')
  const [newMeasure, setNewMeasure] = useState<Measure>('reps')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Build blocks once exercises are loaded.
  useEffect(() => {
    if (blocks || exercises.length === 0) return
    ;(async () => {
      const res = await supabase.from('workout_sets').select('*').eq('workout_id', w.id).order('set_no')
      if (!ok(res)) return
      const saved = res.data as WorkoutSet[]
      const routine = routines.find((r) => r.id === w.routine_id)
      const order = [...(routine?.items.map((i) => i.exercise_id) ?? [])]
      for (const s of saved) if (!order.includes(s.exercise_id)) order.push(s.exercise_id)
      const ids = order.filter((id) => exMap.has(id))
      const last = await lastSets(ids, w.id)
      setBlocks(
        ids.map((id) => {
          const item = routine?.items.find((i) => i.exercise_id === id)
          const mine = saved.filter((s) => s.exercise_id === id)
          const measure = exMap.get(id)!.measure
          const target = item?.target ?? null
          const sets: Draft[] = mine.length
            ? mine.map((s) => ({
                key: k(),
                id: s.id,
                weight: str(s.weight_kg),
                amount: str(measure === 'time' ? s.duration_s : s.reps),
                saved: true,
                dirty: false,
              }))
            : draftsFromLast(item?.sets ?? (last.get(id)?.length || 3), last.get(id) ?? [], measure, target)
          return { exercise_id: id, target, last: last.get(id) ?? [], sets }
        }),
      )
    })()
  }, [exercises, routines, w.id, w.routine_id, exMap, blocks])

  const update = (bi: number, fn: (b: Block) => Block) => setBlocks((bs) => bs!.map((b, i) => (i === bi ? fn(b) : b)))
  const editDraft = (bi: number, si: number, patch: Partial<Draft>) =>
    update(bi, (b) => ({ ...b, sets: b.sets.map((d, i) => (i === si ? { ...d, ...patch, dirty: d.saved ? true : d.dirty } : d)) }))

  async function toggleSet(bi: number, si: number) {
    const b = blocks![bi]
    const d = b.sets[si]
    const measure = exMap.get(b.exercise_id)!.measure
    if (d.saved && !d.dirty) {
      // Un-log
      if (ok(await supabase.from('workout_sets').delete().eq('id', d.id!)))
        update(bi, (b) => ({ ...b, sets: b.sets.map((x, i) => (i === si ? { ...x, id: undefined, saved: false } : x)) }))
      return
    }
    const payload = {
      workout_id: w.id,
      exercise_id: b.exercise_id,
      set_no: si + 1,
      weight_kg: num(d.weight),
      reps: measure === 'reps' ? num(d.amount) : null,
      duration_s: measure === 'time' ? num(d.amount) : null,
    }
    const res = d.id
      ? await supabase.from('workout_sets').update(payload).eq('id', d.id).select('id').single()
      : await supabase.from('workout_sets').insert(payload).select('id').single()
    if (!ok(res) || !res.data) return
    const id = res.data.id as string
    update(bi, (b) => ({ ...b, sets: b.sets.map((x, i) => (i === si ? { ...x, id, saved: true, dirty: false } : x)) }))
    setLastLogged(Date.now())
  }

  async function removeSet(bi: number, si: number) {
    const d = blocks![bi].sets[si]
    if (d.id && !ok(await supabase.from('workout_sets').delete().eq('id', d.id))) return
    update(bi, (b) => ({ ...b, sets: b.sets.filter((_, i) => i !== si) }))
  }

  function addSet(bi: number) {
    update(bi, (b) => {
      const prev = b.sets[b.sets.length - 1]
      return { ...b, sets: [...b.sets, { key: k(), weight: prev?.weight ?? '', amount: prev?.amount ?? '', saved: false, dirty: false }] }
    })
  }

  async function removeBlock(bi: number) {
    const b = blocks![bi]
    if (b.sets.some((s) => s.saved) && !confirm(`Remove ${exMap.get(b.exercise_id)?.name} and its logged sets?`)) return
    const ids = b.sets.filter((s) => s.id).map((s) => s.id!)
    if (ids.length && !ok(await supabase.from('workout_sets').delete().in('id', ids))) return
    setBlocks((bs) => bs!.filter((_, i) => i !== bi))
  }

  async function addExercise(id: string) {
    if (!id || blocks!.some((b) => b.exercise_id === id)) return
    const ex = exMap.get(id)
    const last = (await lastSets([id], w.id)).get(id) ?? []
    setBlocks((bs) => [...bs!, { exercise_id: id, target: null, last, sets: draftsFromLast(last.length || 3, last, ex?.measure ?? 'reps', null) }])
    setAdding('')
  }

  async function createAndAdd() {
    if (!newName.trim()) return
    const ex = await createExercise(newName, w.category, newMeasure)
    if (!ex) return
    await onExercisesChanged()
    setBlocks((bs) => [...bs!, { exercise_id: ex.id, target: null, last: [], sets: draftsFromLast(3, [], ex.measure, null) }])
    setNewName('')
    setAdding('')
  }

  async function finish() {
    const unsaved = blocks?.reduce((n, b) => n + b.sets.filter((s) => !s.saved && (s.amount || s.weight)).length, 0) ?? 0
    if (unsaved && !confirm(`${unsaved} set(s) are not ticked off and won't be saved. Finish anyway?`)) return
    const res = await supabase
      .from('workouts')
      .update({ finished_at: new Date().toISOString(), notes: notes.trim() || null, top_grade: grade || null, gcal_dirty: true })
      .eq('id', w.id)
    if (ok(res)) {
      changed()
      onClose()
    }
  }

  async function discard() {
    if (!confirm('Discard this workout and all its logged sets?')) return
    await supabase.from('workout_sets').delete().eq('workout_id', w.id)
    const res = w.planned_at
      ? await supabase.from('workouts').update({ started_at: null }).eq('id', w.id)
      : await supabase.from('workouts').delete().eq('id', w.id)
    if (ok(res)) onClose()
  }

  const elapsed = Math.max(0, now - new Date(w.started_at!).getTime())
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
  const available = exercises.filter((e) => !e.archived && !blocks?.some((b) => b.exercise_id === e.id))

  return (
    <div className="stack">
      <div className="card row">
        <span className="emoji">{CATEGORY_ICON[w.category]}</span>
        <div className="grow">
          <div className="title">{w.title}</div>
          <div className="small muted">
            {mmss(elapsed)} elapsed{lastLogged && ` · rest ${mmss(now - lastLogged)}`}
          </div>
        </div>
        <button className="primary" onClick={finish}>Finish</button>
      </div>

      {!blocks ? (
        <p className="muted">Loading…</p>
      ) : (
        blocks.map((b, bi) => {
          const ex = exMap.get(b.exercise_id)!
          const time = ex.measure === 'time'
          return (
            <div key={b.exercise_id} className="card stack">
              <div className="row">
                <div className="grow">
                  <div className="title">{ex.name}</div>
                  {b.last.length > 0 && <div className="small muted">Last: {b.last.map((s) => fmtSet(ex.measure, s)).join(' · ')}</div>}
                </div>
                <button className="icon" onClick={() => removeBlock(bi)} aria-label="Remove exercise"><TrashIcon /></button>
              </div>
              <div className="sets">
                <span className="small muted">Set</span>
                <span className="small muted">{time ? '+kg' : 'kg'}</span>
                <span className="small muted">{time ? 'sec' : 'reps'}</span>
                <span />
                {b.sets.map((d, si) => (
                  <SetRow
                    key={d.key}
                    n={si + 1}
                    d={d}
                    onEdit={(p) => editDraft(bi, si, p)}
                    onToggle={() => toggleSet(bi, si)}
                  />
                ))}
              </div>
              <div className="row">
                <button className="link" onClick={() => addSet(bi)}>+ Add set</button>
                {b.sets.length > 0 && (
                  <button
                    className="link muted push"
                    onClick={() => {
                      const last = b.sets[b.sets.length - 1]
                      if (!last.saved || confirm('Remove the last set? It is already logged.')) removeSet(bi, b.sets.length - 1)
                    }}
                  >
                    − Remove last set
                  </button>
                )}
              </div>
            </div>
          )
        })
      )}

      <div className="card stack">
        <select value={adding} onChange={(e) => (e.target.value === 'new' ? setAdding('new') : addExercise(e.target.value))} aria-label="Add exercise">
          <option value="">+ Add exercise…</option>
          {(['lifting', 'bouldering'] as const).map((c) => (
            <optgroup key={c} label={c === 'lifting' ? 'Weightlifting' : 'Bouldering training'}>
              {available.filter((e) => e.category === c).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </optgroup>
          ))}
          <option value="new">New exercise…</option>
        </select>
        {adding === 'new' && (
          <div className="row wrap">
            <input className="grow" placeholder="Exercise name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select value={newMeasure} onChange={(e) => setNewMeasure(e.target.value as Measure)} aria-label="Measured in">
              <option value="reps">Reps</option>
              <option value="time">Seconds</option>
            </select>
            <button className="primary" disabled={!newName.trim()} onClick={createAndAdd}>Add</button>
          </div>
        )}
      </div>

      <div className="card stack">
        {w.category === 'bouldering' && (
          <label>
            <span className="label">Hardest send today (Font)</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">—</option>
              {FONT_GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
        )}
        <textarea rows={2} placeholder="Notes (how it felt, …)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="row">
          <button className="danger-btn" onClick={discard}>Discard</button>
          <button className="primary grow" onClick={finish}>Finish workout</button>
        </div>
      </div>
    </div>
  )
}

function SetRow({ n, d, onEdit, onToggle }: { n: number; d: Draft; onEdit: (p: Partial<Draft>) => void; onToggle: () => void }) {
  const done = d.saved && !d.dirty
  return (
    <>
      <span className={`setno ${done ? 'on' : ''}`}>{n}</span>
      <input type="text" inputMode="decimal" value={d.weight} placeholder="0" onChange={(e) => onEdit({ weight: e.target.value })} aria-label="Weight kg" />
      <input type="text" inputMode="numeric" value={d.amount} placeholder="0" onChange={(e) => onEdit({ amount: e.target.value })} aria-label="Reps or seconds" />
      <button className={`tick ${done ? 'on' : ''}`} onClick={onToggle} aria-pressed={done} aria-label={done ? 'Logged' : 'Log set'}>✓</button>
    </>
  )
}
