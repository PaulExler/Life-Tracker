import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok, toast } from '../../lib/toast'
import { dayStr } from '../../lib/date'
import { accountOf, bookDueRecurring, downloadCsv, eur, loadAccounts, loadCategories, monthRange, parseAmount } from '../../lib/money'
import type { Expense, SpendAccount, SpendCategory } from '../../lib/types'
import { EditIcon, TrashIcon } from '../../components/Icons'
import { RecurringSection } from './Recurring'

const LS_ACCOUNT = 'money_account'
const lsGet = () => {
  try {
    return localStorage.getItem(LS_ACCOUNT)
  } catch {
    return null
  }
}
const lsSet = (v: string) => {
  try {
    localStorage.setItem(LS_ACCOUNT, v)
  } catch {
    /* storage unavailable */
  }
}

export function MoneyPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [cats, setCats] = useState<SpendCategory[]>([])
  const [accounts, setAccounts] = useState<SpendAccount[]>([])
  const [account, setAccountState] = useState<string>(lsGet() ?? 'all') // 'all' or account id
  const [expenses, setExpenses] = useState<Expense[] | null>(null)
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const thisMonth = monthRange(new Date())[0] === monthRange(month)[0]
  const setAccount = (v: string) => {
    setAccountState(v)
    setCatFilter(null)
    lsSet(v)
  }

  const load = useCallback(async () => {
    const [a, b] = monthRange(month)
    const res = await supabase
      .from('expenses')
      .select('*')
      .gte('spent_on', a)
      .lt('spent_on', b)
      .order('spent_on', { ascending: false })
      .order('created_at', { ascending: false })
    if (ok(res)) setExpenses(res.data as Expense[])
  }, [month])

  useEffect(() => {
    loadCategories().then(setCats)
    loadAccounts().then(setAccounts)
  }, [])

  useEffect(() => {
    bookDueRecurring().then((n) => {
      if (n) toast(`${n} recurring payment${n === 1 ? '' : 's'} booked`)
      load()
    })
  }, [load])

  // A remembered account that no longer exists falls back to "All".
  useEffect(() => {
    if (accounts.length && account !== 'all' && !accounts.some((a) => a.id === account && !a.archived)) setAccount('all')
  }, [accounts, account])

  const activeAccounts = accounts.filter((a) => !a.archived)
  const multi = activeAccounts.length > 1
  const inAccount = (accId: string | null) => account === 'all' || accountOf(accId, accounts)?.id === account
  const accExpenses = (expenses ?? []).filter((e) => inAccount(e.account_id))
  const catMap = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])
  const total = accExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const budget = cats.filter((c) => !c.archived && c.monthly_budget).reduce((s, c) => s + Number(c.monthly_budget), 0)
  const shown = accExpenses.filter((e) => !catFilter || (e.category_id ?? 'none') === catFilter)
  const currentAcc = account === 'all' ? null : accounts.find((a) => a.id === account)
  // Category budgets belong to the default (personal) account.
  const budgetView = !multi || (currentAcc != null && currentAcc.id === accountOf(null, accounts)?.id)

  const byDay = useMemo(() => {
    const m = new Map<string, Expense[]>()
    for (const e of shown) m.set(e.spent_on, [...(m.get(e.spent_on) ?? []), e])
    return [...m]
  }, [shown])

  function exportCsv() {
    const label = currentAcc?.name ?? 'all'
    const ym = monthRange(month)[0].slice(0, 7)
    downloadCsv(`expenses-${label.toLowerCase().replace(/\s+/g, '-')}-${ym}.csv`, accExpenses, cats, accounts)
  }

  return (
    <div className="stack">
      {multi && (
        <div className="segmented scroll" role="tablist" aria-label="Account">
          <button role="tab" aria-selected={account === 'all'} className={account === 'all' ? 'on' : ''} onClick={() => setAccount('all')}>All</button>
          {activeAccounts.map((a) => (
            <button key={a.id} role="tab" aria-selected={account === a.id} className={account === a.id ? 'on' : ''} onClick={() => setAccount(a.id)}>
              {a.icon} {a.name}
            </button>
          ))}
        </div>
      )}

      <div className="row day-nav">
        <button className="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
        <h3 className="grow center">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
        <button className="icon" disabled={thisMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
      </div>

      <div className="card stack">
        <div className="row baseline">
          <span className="big">{eur(total)}</span>
          <span className="muted grow">
            {budgetView && budget ? `of ${eur(budget)} budget` : currentAcc ? `${currentAcc.icon} ${currentAcc.name}` : 'spent'}
          </span>
          {budgetView && budget > 0 && (
            <span className={`small ${total > budget ? 'danger' : 'muted'}`}>{total > budget ? `${eur(total - budget)} over` : `${eur(budget - total)} left`}</span>
          )}
        </div>
        {budgetView && budget > 0 && (
          <div className="bar"><div style={{ width: `${Math.min(100, (total / budget) * 100)}%`, background: total > budget ? 'var(--danger)' : undefined }} /></div>
        )}
        {multi && account === 'all' && accExpenses.length > 0 && (
          <div className="macro-row">
            {activeAccounts.map((a) => (
              <span key={a.id}>{a.icon} {a.name} {eur(accExpenses.filter((e) => accountOf(e.account_id, accounts)?.id === a.id).reduce((s, e) => s + Number(e.amount), 0))}</span>
            ))}
          </div>
        )}
      </div>

      <ExpenseForm
        cats={cats}
        accounts={accounts}
        defaultAccount={account === 'all' ? null : account}
        defaultDate={thisMonth ? dayStr() : monthRange(month)[0]}
        onSaved={load}
      />

      {accExpenses.length > 0 && (
        <CategoryBreakdown cats={cats} expenses={accExpenses} selected={catFilter} onSelect={setCatFilter} showBudgets={budgetView} />
      )}

      {!expenses ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">No expenses {catFilter ? 'in this category ' : ''}{currentAcc ? `for ${currentAcc.name} ` : ''}this month.</p>
      ) : (
        byDay.map(([day, list]) => (
          <section key={day} className="stack">
            <h2>
              {new Date(`${day}T00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
              {eur(list.reduce((s, e) => s + Number(e.amount), 0))}
            </h2>
            <ul className="list">
              {list.map((e) => (
                <ExpenseRow
                  key={e.id}
                  e={e}
                  cats={cats}
                  accounts={accounts}
                  showAccount={multi && account === 'all'}
                  cat={e.category_id ? catMap.get(e.category_id) : undefined}
                  onChanged={load}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {accExpenses.length > 0 && (
        <button className="link" onClick={exportCsv}>⬇ Export {currentAcc ? currentAcc.name : 'all'} · {month.toLocaleDateString('en-GB', { month: 'long' })} as CSV (Excel)</button>
      )}

      <RecurringSection cats={cats} accounts={accounts} account={account} onBooked={load} />
    </div>
  )
}

function CategoryBreakdown({
  cats,
  expenses,
  selected,
  onSelect,
  showBudgets,
}: {
  cats: SpendCategory[]
  expenses: Expense[]
  selected: string | null
  onSelect: (id: string | null) => void
  showBudgets: boolean
}) {
  const rows = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of expenses) sums.set(e.category_id ?? 'none', (sums.get(e.category_id ?? 'none') ?? 0) + Number(e.amount))
    const list = cats
      .filter((c) => sums.has(c.id) || (showBudgets && !c.archived && c.monthly_budget))
      .map((c) => ({ id: c.id, label: `${c.icon} ${c.name}`, spent: sums.get(c.id) ?? 0, budget: showBudgets && c.monthly_budget ? Number(c.monthly_budget) : null }))
    if (sums.has('none')) list.push({ id: 'none', label: '💶 Uncategorised', spent: sums.get('none')!, budget: null })
    return list.sort((a, b) => b.spent - a.spent)
  }, [cats, expenses, showBudgets])
  const max = Math.max(1, ...rows.map((r) => Math.max(r.spent, r.budget ?? 0)))

  return (
    <div className="card stack">
      <div className="row">
        <h3 className="grow">By category</h3>
        {selected && <button className="link" onClick={() => onSelect(null)}>Show all</button>}
      </div>
      {rows.map((r) => {
        const over = r.budget != null && r.spent > r.budget
        const pct = Math.min(100, (r.spent / (r.budget ?? max)) * 100)
        return (
          <button key={r.id} className={`cat-row ${selected === r.id ? 'sel' : ''}`} onClick={() => onSelect(selected === r.id ? null : r.id)}>
            <div className="row">
              <span className="grow">{r.label}</span>
              <span className={over ? 'danger' : ''}>{eur(r.spent)}</span>
              {r.budget != null && <span className="small muted"> / {eur(r.budget)}</span>}
            </div>
            <div className="bar thin">
              <div style={{ width: `${pct}%`, background: over ? 'var(--danger)' : undefined }} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function CategoryChips({ cats, value, onChange }: { cats: SpendCategory[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="row wrap">
      {cats
        .filter((c) => !c.archived || c.id === value)
        .map((c) => (
          <button key={c.id} type="button" className={`chip ${value === c.id ? 'on' : ''}`} onClick={() => onChange(c.id)} aria-pressed={value === c.id}>
            {c.icon} {c.name}
          </button>
        ))}
    </div>
  )
}

/** Account picker; hidden when there is only one account. `value` null = default account. */
export function AccountChips({ accounts, value, onChange }: { accounts: SpendAccount[]; value: string | null; onChange: (id: string) => void }) {
  const active = accounts.filter((a) => !a.archived || a.id === value)
  if (active.filter((a) => !a.archived).length < 2) return null
  const current = accountOf(value, accounts)?.id
  return (
    <div className="row wrap account-chips">
      {active.map((a) => (
        <button key={a.id} type="button" className={`chip ${current === a.id ? 'on' : ''}`} onClick={() => onChange(a.id)} aria-pressed={current === a.id}>
          {a.icon} {a.name}
        </button>
      ))}
    </div>
  )
}

function ExpenseForm({
  cats,
  accounts,
  expense,
  defaultAccount,
  defaultDate,
  onSaved,
  onCancel,
}: {
  cats: SpendCategory[]
  accounts: SpendAccount[]
  expense?: Expense
  defaultAccount?: string | null
  defaultDate?: string
  onSaved: () => void
  onCancel?: () => void
}) {
  const [amount, setAmount] = useState(expense ? String(+expense.amount).replace('.', ',') : '')
  const [cat, setCat] = useState<string | null>(expense?.category_id ?? null)
  const [acc, setAcc] = useState<string | null>(expense ? expense.account_id : defaultAccount ?? null)
  const [note, setNote] = useState(expense?.note ?? '')
  const [date, setDate] = useState(expense?.spent_on ?? defaultDate ?? dayStr())
  const [open, setOpen] = useState(!!expense)

  useEffect(() => {
    if (!expense && defaultDate) setDate(defaultDate)
  }, [defaultDate, expense])
  useEffect(() => {
    if (!expense) setAcc(defaultAccount ?? null)
  }, [defaultAccount, expense])

  async function save() {
    const a = parseAmount(amount)
    if (!a) return toast('Enter an amount, e.g. 12,50')
    const row = { amount: a, category_id: cat, account_id: acc ?? accountOf(null, accounts)?.id ?? null, note: note.trim() || null, spent_on: date }
    const res = expense ? await supabase.from('expenses').update(row).eq('id', expense.id) : await supabase.from('expenses').insert(row)
    if (!ok(res)) return
    if (!expense) {
      setAmount('')
      setNote('')
      setCat(null)
      setOpen(false)
      toast(`${eur(a)} added`)
    }
    onSaved()
  }

  if (!open && !expense) return <button className="primary" onClick={() => setOpen(true)}>+ Add expense</button>

  return (
    <div className={expense ? 'stack' : 'card stack'}>
      <AccountChips accounts={accounts} value={acc} onChange={setAcc} />
      <div className="row">
        <span className="big muted">€</span>
        <input className="grow amount-input" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus aria-label="Amount" />
      </div>
      <CategoryChips cats={cats} value={cat} onChange={setCat} />
      <div className="row">
        <input className="grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
      </div>
      <div className="row end">
        <button onClick={() => (onCancel ? onCancel() : setOpen(false))}>Cancel</button>
        <button className="primary" onClick={save} disabled={!parseAmount(amount)}>{expense ? 'Save' : 'Add'}</button>
      </div>
    </div>
  )
}

function ExpenseRow({
  e,
  cat,
  cats,
  accounts,
  showAccount,
  onChanged,
}: {
  e: Expense
  cat?: SpendCategory
  cats: SpendCategory[]
  accounts: SpendAccount[]
  showAccount: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const acc = accountOf(e.account_id, accounts)

  async function remove() {
    if (!confirm(`Delete ${eur(Number(e.amount))}${e.note ? ` (${e.note})` : ''}?`)) return
    if (ok(await supabase.from('expenses').delete().eq('id', e.id))) onChanged()
  }

  if (editing)
    return (
      <li className="item">
        <ExpenseForm
          cats={cats}
          accounts={accounts}
          expense={e}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
        />
      </li>
    )

  return (
    <li className="item row">
      <span className="emoji">{cat?.icon ?? '💶'}</span>
      <div className="grow">
        <div className="title">{e.note || cat?.name || 'Expense'}</div>
        <div className="small muted">
          {cat?.name ?? 'Uncategorised'}
          {showAccount && acc ? ` · ${acc.icon} ${acc.name}` : ''}
          {e.recurring_id ? ' · recurring' : ''}
        </div>
      </div>
      <strong>{eur(Number(e.amount))}</strong>
      <button className="icon" onClick={() => setEditing(true)} aria-label="Edit"><EditIcon /></button>
      <button className="icon" onClick={remove} aria-label="Delete"><TrashIcon /></button>
    </li>
  )
}

/** Compact "spent this month" card for the Today screen (all accounts). */
export function TodayMoney() {
  const [total, setTotal] = useState<number | null>(null)
  useEffect(() => {
    bookDueRecurring().then(async () => {
      const [a, b] = monthRange(new Date())
      const res = await supabase.from('expenses').select('amount').gte('spent_on', a).lt('spent_on', b)
      if (ok(res)) setTotal((res.data as { amount: number }[]).reduce((s, e) => s + Number(e.amount), 0))
    })
  }, [])
  return (
    <a href="#money" className="plain-link card row">
      <span className="grow muted">Spent in {new Date().toLocaleDateString('en-GB', { month: 'long' })}</span>
      <strong>{total == null ? '…' : eur(total)}</strong>
    </a>
  )
}
