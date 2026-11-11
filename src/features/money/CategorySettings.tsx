import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { eur, loadCategories, parseAmount } from '../../lib/money'
import type { SpendCategory } from '../../lib/types'
import { EditIcon } from '../../components/Icons'

/** Settings → Spending categories: rename, icon, monthly budget, hide/restore, add. */
export function CategorySettings() {
  const [cats, setCats] = useState<SpendCategory[] | null>(null)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const reload = () => loadCategories().then(setCats)

  if (!cats)
    return (
      <div className="card row">
        <div className="grow">
          <h3>Spending categories</h3>
          <div className="small muted">Rename, change icons, set monthly budgets.</div>
        </div>
        <button onClick={reload}>Manage</button>
      </div>
    )

  async function add() {
    if (!newName.trim()) return
    const sort = Math.max(0, ...cats!.filter((c) => c.sort < 999).map((c) => c.sort)) + 10
    if (ok(await supabase.from('spend_categories').insert({ name: newName.trim(), icon: newIcon.trim() || '💶', sort }))) {
      setNewName('')
      setNewIcon('')
      reload()
    }
  }

  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow">Spending categories</h3>
        <button className="link" onClick={() => setCats(null)}>Close</button>
      </div>
      <ul className="list">
        {cats.map((c) => <CategoryRow key={c.id} c={c} onChanged={reload} />)}
      </ul>
      <div className="row">
        <input style={{ width: 56 }} placeholder="🙂" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} aria-label="Icon" />
        <input className="grow" placeholder="New category" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="primary" disabled={!newName.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

function CategoryRow({ c, onChanged }: { c: SpendCategory; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [icon, setIcon] = useState(c.icon)
  const [budget, setBudget] = useState(c.monthly_budget ? String(+c.monthly_budget).replace('.', ',') : '')

  async function save() {
    const row = { name: name.trim() || c.name, icon: icon.trim() || '💶', monthly_budget: budget.trim() ? parseAmount(budget) : null }
    if (ok(await supabase.from('spend_categories').update(row).eq('id', c.id))) {
      setEditing(false)
      onChanged()
    }
  }
  async function setHidden(archived: boolean) {
    if (ok(await supabase.from('spend_categories').update({ archived }).eq('id', c.id))) onChanged()
  }

  if (editing)
    return (
      <li className="item stack">
        <div className="row">
          <input style={{ width: 56 }} value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon" />
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </div>
        <label>
          <span className="label">Monthly budget (optional, €)</span>
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 250" />
        </label>
        <div className="row">
          <button className="danger-btn" onClick={() => setHidden(true)}>Hide</button>
          <button className="push" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </li>
    )

  return (
    <li className={`item row ${c.archived ? 'done' : ''}`}>
      <span className="emoji">{c.icon}</span>
      <div className="grow">
        <div className="title">{c.name}</div>
        <div className="small muted">{c.monthly_budget ? `Budget ${eur(Number(c.monthly_budget))} / month` : 'No budget'}{c.archived && ' · hidden'}</div>
      </div>
      {c.archived ? (
        <button className="link" onClick={() => setHidden(false)}>Show again</button>
      ) : (
        <button className="icon" onClick={() => setEditing(true)} aria-label={`Edit ${c.name}`}><EditIcon /></button>
      )}
    </li>
  )
}
