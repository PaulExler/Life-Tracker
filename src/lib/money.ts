import { supabase } from './supabase'
import { ok } from './toast'
import { dayStr } from './date'
import type { Interval, RecurringExpense, SpendCategory } from './types'

const fmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
export const eur = (n: number) => fmt.format(n)

/** Accepts "12,50" or "12.50". */
export const parseAmount = (s: string) => {
  const v = Number(s.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null
}

export const INTERVAL_LABEL: Record<Interval, string> = { weekly: 'weekly', monthly: 'monthly', quarterly: 'every 3 months', yearly: 'yearly' }
const PER_MONTH: Record<Interval, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
export const monthlyEquivalent = (r: Pick<RecurringExpense, 'amount' | 'interval'>) => Number(r.amount) * PER_MONTH[r.interval]

const DEFAULT_CATEGORIES: { name: string; icon: string; sort: number }[] = [
  { name: 'Groceries', icon: '🛒', sort: 10 },
  { name: 'Eating out', icon: '🍽️', sort: 20 },
  { name: 'Transport', icon: '🚆', sort: 30 },
  { name: 'Sport & fitness', icon: '🏋️', sort: 40 },
  { name: 'Subscriptions', icon: '🔁', sort: 50 },
  { name: 'Housing', icon: '🏠', sort: 60 },
  { name: 'University', icon: '🎓', sort: 70 },
  { name: 'Going out & fun', icon: '🎉', sort: 80 },
  { name: 'Shopping', icon: '🛍️', sort: 90 },
  { name: 'Health', icon: '💊', sort: 100 },
  { name: 'Other', icon: '💶', sort: 999 },
]

/** All categories (incl. hidden, for history). Seeds a starter list on first use. */
export async function loadCategories(): Promise<SpendCategory[]> {
  const q = () => supabase.from('spend_categories').select('*').order('sort').order('name')
  let res = await q()
  if (!ok(res)) return []
  if (!res.data?.length) {
    await supabase.from('spend_categories').upsert(DEFAULT_CATEGORIES, { onConflict: 'user_id,name', ignoreDuplicates: true })
    res = await q()
    if (!ok(res)) return []
  }
  return (res.data ?? []) as SpendCategory[]
}

// ---------- recurring dates ----------
const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** n-th payment date after start (n = 0 is the start). Months clamp to the month's last day (31st → 30th/28th). */
export function occurrence(start: string, interval: Interval, n: number): string {
  const s = parseDay(start)
  if (interval === 'weekly') return dayStr(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * n))
  const months = n * (interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12)
  const y = s.getFullYear()
  const m = s.getMonth() + months
  const last = new Date(y, m + 1, 0).getDate()
  return dayStr(new Date(y, m, Math.min(s.getDate(), last)))
}

/** First payment date on or after `from`. */
export function nextOnOrAfter(start: string, interval: Interval, from: string): string {
  for (let n = 0; n < 5000; n++) {
    const d = occurrence(start, interval, n)
    if (d >= from) return d
  }
  return from
}

/**
 * Book every recurring payment that has come due (up to today) as an expense and move next_due forward.
 * Safe to run from several devices: the (recurring_id, spent_on) unique key prevents double booking.
 */
export async function bookDueRecurring(): Promise<number> {
  const today = dayStr()
  const res = await supabase.from('recurring_expenses').select('*').eq('active', true).lte('next_due', today)
  if (!ok(res) || !res.data?.length) return 0
  let booked = 0
  for (const r of res.data as RecurringExpense[]) {
    const rows: Record<string, unknown>[] = []
    let n = 0
    while (occurrence(r.start_date, r.interval, n) < r.next_due) n++
    let d = occurrence(r.start_date, r.interval, n)
    while (d <= today && rows.length < 120) {
      rows.push({ spent_on: d, amount: r.amount, category_id: r.category_id, note: r.name, recurring_id: r.id })
      d = occurrence(r.start_date, r.interval, ++n)
    }
    if (rows.length) {
      const ins = await supabase.from('expenses').upsert(rows, { onConflict: 'recurring_id,spent_on', ignoreDuplicates: true })
      if (!ok(ins)) continue
      booked += rows.length
    }
    await supabase.from('recurring_expenses').update({ next_due: d }).eq('id', r.id)
  }
  return booked
}

export const monthRange = (month: Date) => {
  const a = new Date(month.getFullYear(), month.getMonth(), 1)
  const b = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  return [dayStr(a), dayStr(b)] as const
}
