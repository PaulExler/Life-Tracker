import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok } from '../../lib/toast'
import { eur, loadAccounts, loadCategories, parseAmount } from '../../lib/money'
import type { SpendAccount, SpendCategory } from '../../lib/types'
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

/** Settings → Spending accounts: e.g. Personal, Lifewatch. The first one is the default. */
export function AccountSettings() {
  const [accounts, setAccounts] = useState<SpendAccount[] | null>(null)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const reload = () => loadAccounts().then(setAccounts)

  if (!accounts)
    return (
      <div className="card row">
        <div className="grow">
          <h3>Spending accounts</h3>
          <div className="small muted">Personal, Lifewatch, … — keep expenses apart.</div>
        </div>
        <button onClick={reload}>Manage</button>
      </div>
    )

  async function add() {
    if (!newName.trim()) return
    const sort = Math.max(0, ...accounts!.map((a) => a.sort)) + 10
    if (ok(await supabase.from('spend_accounts').insert({ name: newName.trim(), icon: newIcon.trim() || '🏢', sort }))) {
      setNewName('')
      setNewIcon('')
      reload()
    }
  }

  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow">Spending accounts</h3>
        <button className="link" onClick={() => setAccounts(null)}>Close</button>
      </div>
      <p className="small muted">The first account is the default: entries without an account count there, and category budgets apply to it.</p>
      <ul className="list">
        {accounts.map((a, i) => <AccountRow key={a.id} a={a} isDefault={i === accounts.findIndex((x) => !x.archived)} onChanged={reload} />)}
      </ul>
      <div className="row">
        <input style={{ width: 56 }} placeholder="🏢" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} aria-label="Icon" />
        <input className="grow" placeholder="New account, e.g. a project" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="primary" disabled={!newName.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

function AccountRow({ a, isDefault, onChanged }: { a: SpendAccount; isDefault: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(a.name)
  const [icon, setIcon] = useState(a.icon)

  async function save() {
    if (ok(await supabase.from('spend_accounts').update({ name: name.trim() || a.name, icon: icon.trim() || '👤' }).eq('id', a.id))) {
      setEditing(false)
      onChanged()
    }
  }
  async function setHidden(archived: boolean) {
    if (ok(await supabase.from('spend_accounts').update({ archived }).eq('id', a.id))) onChanged()
  }

  if (editing)
    return (
      <li className="item stack">
        <div className="row">
          <input style={{ width: 56 }} value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon" />
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </div>
        <div className="row">
          {!isDefault && <button className="danger-btn" onClick={() => setHidden(true)}>Hide</button>}
          <button className="push" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </li>
    )

  return (
    <li className={`item row ${a.archived ? 'done' : ''}`}>
      <span className="emoji">{a.icon}</span>
      <div className="grow">
        <div className="title">{a.name}</div>
        <div className="small muted">{isDefault ? 'Default' : ''}{a.archived ? 'Hidden' : ''}</div>
      </div>
      {a.archived ? (
        <button className="link" onClick={() => setHidden(false)}>Show again</button>
      ) : (
        <button className="icon" onClick={() => setEditing(true)} aria-label={`Edit ${a.name}`}><EditIcon /></button>
      )}
    </li>
  )
}
