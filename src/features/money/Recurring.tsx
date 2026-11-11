import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok, toast } from '../../lib/toast'
import { dayStr } from '../../lib/date'
import { accountOf, bookDueRecurring, eur, INTERVAL_LABEL, monthlyEquivalent, nextOnOrAfter, parseAmount } from '../../lib/money'
import type { Interval, RecurringExpense, SpendAccount, SpendCategory } from '../../lib/types'
import { EditIcon } from '../../components/Icons'
import { AccountChips, CategoryChips } from './MoneyPage'

const fmtDate = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function RecurringSection({
  cats,
  accounts,
  account,
  onBooked,
}: {
  cats: SpendCategory[]
  accounts: SpendAccount[]
  account: string
  onBooked: () => void
}) {
  const [items, setItems] = useState<RecurringExpense[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await supabase.from('recurring_expenses').select('*').order('active', { ascending: false }).order('name')
    if (ok(res)) setItems(res.data as RecurringExpense[])
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const changed = async () => {
    setAdding(false)
    const n = await bookDueRecurring()
    if (n) toast(`${n} payment${n === 1 ? '' : 's'} booked`)
    load()
    onBooked()
  }

  const multi = accounts.filter((a) => !a.archived).length > 1
  const visible = (items ?? []).filter((r) => account === 'all' || accountOf(r.account_id, accounts)?.id === account)
  const perMonth = visible.filter((r) => r.active).reduce((s, r) => s + monthlyEquivalent(r), 0)

  return (
    <section className="stack">
      <h2>Recurring · ≈ {eur(perMonth)} / month</h2>
      {visible.length > 0 && (
        <ul className="list">
          {visible.map((r) => (
            <RecurringRow key={r.id} r={r} cats={cats} accounts={accounts} showAccount={multi && account === 'all'} onChanged={changed} />
          ))}
        </ul>
      )}
      {items && visible.length === 0 && !adding && <p className="small muted">Add memberships, subscriptions or rent — they're booked automatically when due.</p>}
      {adding ? <RecurringForm cats={cats} accounts={accounts} defaultAccount={account === 'all' ? null : account} onDone={changed} onCancel={() => setAdding(false)} /> : <button onClick={() => setAdding(true)}>+ Add recurring payment</button>}
    </section>
  )
}

function RecurringRow({
  r,
  cats,
  accounts,
  showAccount,
  onChanged,
}: {
  r: RecurringExpense
  cats: SpendCategory[]
  accounts: SpendAccount[]
  showAccount: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const cat = cats.find((c) => c.id === r.category_id)
  const acc = accountOf(r.account_id, accounts)
  if (editing) return <li className="item"><RecurringForm r={r} cats={cats} accounts={accounts} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} /></li>
  return (
    <li className={`item row ${r.active ? '' : 'done'}`}>
      <span className="emoji">{cat?.icon ?? '🔁'}</span>
      <div className="grow">
        <div className="title">{r.name}</div>
        <div className="small muted">
          {INTERVAL_LABEL[r.interval]} · {r.active ? `next ${fmtDate(r.next_due)}` : 'paused'}
          {showAccount && acc ? ` · ${acc.icon} ${acc.name}` : ''}
        </div>
      </div>
      <strong>{eur(Number(r.amount))}</strong>
      <button className="icon" onClick={() => setEditing(true)} aria-label={`Edit ${r.name}`}><EditIcon /></button>
    </li>
  )
}

function RecurringForm({
  r,
  cats,
  accounts,
  defaultAccount,
  onDone,
  onCancel,
}: {
  r?: RecurringExpense
  cats: SpendCategory[]
  accounts: SpendAccount[]
  defaultAccount?: string | null
  onDone: () => void
  onCancel: () => void
}) {
  const [acc, setAcc] = useState<string | null>(r ? r.account_id : defaultAccount ?? null)
  const [name, setName] = useState(r?.name ?? '')
  const [amount, setAmount] = useState(r ? String(+r.amount).replace('.', ',') : '')
  const [cat, setCat] = useState<string | null>(r?.category_id ?? cats.find((c) => c.name === 'Subscriptions')?.id ?? null)
  const [interval, setIntv] = useState<Interval>(r?.interval ?? 'monthly')
  const [start, setStart] = useState(r?.start_date ?? dayStr())
  const [backfill, setBackfill] = useState(false)
  const today = dayStr()

  async function save() {
    const a = parseAmount(amount)
    if (!name.trim() || !a || !start) return toast('Name, amount and first payment date are needed.')
    const scheduleChanged = !r || r.start_date !== start || r.interval !== interval
    // New items only book past payments if asked; otherwise the first booking is the next one from today.
    const next_due = scheduleChanged ? nextOnOrAfter(start, interval, backfill ? start : today) : r!.next_due
    const row = { name: name.trim(), amount: a, category_id: cat, account_id: acc ?? accountOf(null, accounts)?.id ?? null, interval, start_date: start, next_due }
    const res = r ? await supabase.from('recurring_expenses').update(row).eq('id', r.id) : await supabase.from('recurring_expenses').insert(row)
    if (ok(res)) onDone()
  }

  async function setActive(active: boolean) {
    // Resuming skips the paused period instead of booking it.
    const patch = active ? { active, next_due: nextOnOrAfter(r!.start_date, r!.interval, today) } : { active }
    if (ok(await supabase.from('recurring_expenses').update(patch).eq('id', r!.id))) onDone()
  }

  async function remove() {
    if (!confirm(`Delete "${r!.name}"? Payments already booked stay in your expenses.`)) return
    if (ok(await supabase.from('recurring_expenses').delete().eq('id', r!.id))) onDone()
  }

  return (
    <div className={r ? 'stack' : 'card stack'}>
      <AccountChips accounts={accounts} value={acc} onChange={setAcc} />
      <input placeholder="Name, e.g. Gym membership" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <div className="row">
        <span className="muted">€</span>
        <input className="grow" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        <select value={interval} onChange={(e) => setIntv(e.target.value as Interval)} aria-label="Interval">
          {(Object.keys(INTERVAL_LABEL) as Interval[]).map((i) => <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>)}
        </select>
      </div>
      <label>
        <span className="label">{r ? 'First payment (schedule follows from this date)' : 'First / a past payment date'}</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      {!r && start < today && (
        <label className="row small">
          <input type="checkbox" className="check" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
          Also add the past payments since {fmtDate(start)}
        </label>
      )}
      <CategoryChips cats={cats} value={cat} onChange={setCat} />
      <div className="row">
        {r && <button className="danger-btn" onClick={remove}>Delete</button>}
        {r && <button onClick={() => setActive(!r.active)}>{r.active ? 'Pause' : 'Resume'}</button>}
        <button className="push" onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={save}>{r ? 'Save' : 'Add'}</button>
      </div>
    </div>
  )
}
