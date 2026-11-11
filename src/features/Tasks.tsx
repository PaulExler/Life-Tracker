import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { ok } from '../lib/toast'
import { changed, forgetEvent } from '../lib/gcal'
import { addDays, fmtDue, fromLocalInput, startOfDay, toLocalInput } from '../lib/date'
import type { Task } from '../lib/types'
import { EditIcon, TrashIcon } from '../components/Icons'

const sortOpen = (a: Task, b: Task) =>
  (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.created_at.localeCompare(b.created_at)

/** mode "today": open tasks due today or overdue (for the Today screen). */
export function TaskList({ mode = 'all' }: { mode?: 'all' | 'today' }) {
  const [open, setOpen] = useState<Task[]>([])
  const [done, setDone] = useState<Task[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('tasks').select('*').is('done_at', null)
    if (mode === 'today') q = q.lt('due_at', addDays(startOfDay(), 1).toISOString())
    const res = await q
    if (ok(res)) setOpen((res.data as Task[]).sort(sortOpen))
    if (mode === 'all') {
      const r2 = await supabase
        .from('tasks')
        .select('*')
        .not('done_at', 'is', null)
        .order('done_at', { ascending: false })
        .limit(30)
      if (ok(r2)) setDone(r2.data as Task[])
    }
    setLoaded(true)
  }, [mode])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(t: Task) {
    const done_at = t.done_at ? null : new Date().toISOString()
    // Optimistic update
    if (done_at) {
      setOpen((o) => o.filter((x) => x.id !== t.id))
      setDone((d) => [{ ...t, done_at }, ...d])
    } else {
      setDone((d) => d.filter((x) => x.id !== t.id))
      setOpen((o) => [...o, { ...t, done_at }].sort(sortOpen))
    }
    if (ok(await supabase.from('tasks').update({ done_at, gcal_dirty: true }).eq('id', t.id))) changed()
    else load()
  }

  async function remove(t: Task) {
    if (!confirm(`Delete "${t.title}"?`)) return
    setOpen((o) => o.filter((x) => x.id !== t.id))
    setDone((d) => d.filter((x) => x.id !== t.id))
    await forgetEvent(t.gcal_event_id)
    if (ok(await supabase.from('tasks').delete().eq('id', t.id))) changed()
    else load()
  }

  async function save(t: Task, patch: Partial<Task>) {
    if (ok(await supabase.from('tasks').update({ ...patch, gcal_dirty: true }).eq('id', t.id))) {
      load()
      changed()
    }
  }

  return (
    <div className="stack">
      {mode === 'all' && <TaskForm onAdded={load} />}
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : open.length === 0 ? (
        <p className="muted">{mode === 'today' ? 'Nothing due today.' : 'No open tasks. Nice.'}</p>
      ) : (
        <ul className="list">
          {open.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onSave={save} />
          ))}
        </ul>
      )}
      {mode === 'all' && done.length > 0 && (
        <>
          <button className="link" onClick={() => setShowDone((s) => !s)}>
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
          {showDone && (
            <ul className="list">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={toggle} onRemove={remove} onSave={save} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function TaskForm({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const res = await supabase.from('tasks').insert({ title: title.trim(), due_at: fromLocalInput(due) })
    setBusy(false)
    if (ok(res)) {
      setTitle('')
      setDue('')
      onAdded()
      changed()
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <input placeholder="New task…" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="row">
        <label className="grow">
          <span className="label">Deadline (optional)</span>
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !title.trim()}>Add</button>
      </div>
    </form>
  )
}

function TaskRow({
  task: t,
  onToggle,
  onRemove,
  onSave,
}: {
  task: Task
  onToggle: (t: Task) => void
  onRemove: (t: Task) => void
  onSave: (t: Task, patch: Partial<Task>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(t.title)
  const [due, setDue] = useState(toLocalInput(t.due_at))
  const [notes, setNotes] = useState(t.notes ?? '')
  const overdue = !t.done_at && t.due_at && new Date(t.due_at) < new Date()

  if (editing) {
    return (
      <li className="item stack">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <textarea placeholder="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="row end">
          <button onClick={() => setEditing(false)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              onSave(t, { title: title.trim() || t.title, due_at: fromLocalInput(due), notes: notes.trim() || null })
              setEditing(false)
            }}
          >
            Save
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={`item row ${t.done_at ? 'done' : ''}`}>
      <input type="checkbox" className="check" checked={!!t.done_at} onChange={() => onToggle(t)} aria-label="Done" />
      <div className="grow">
        <div className="title">{t.title}</div>
        {t.due_at && <div className={`small ${overdue ? 'danger' : 'muted'}`}>{fmtDue(t.due_at)}</div>}
        {t.notes && <div className="small muted pre">{t.notes}</div>}
      </div>
      <button className="icon" onClick={() => setEditing(true)} aria-label="Edit"><EditIcon /></button>
      <button className="icon" onClick={() => onRemove(t)} aria-label="Delete"><TrashIcon /></button>
    </li>
  )
}
