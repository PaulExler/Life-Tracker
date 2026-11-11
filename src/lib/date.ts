export const DAY_MS = 86_400_000

/** Local calendar day as YYYY-MM-DD. */
export function dayStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Monday of the week containing d. */
export function startOfWeek(d: Date = new Date()): Date {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDue(iso: string): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(d).getTime() - startOfDay().getTime()) / DAY_MS)
  const label =
    diff === 0 ? 'Today'
    : diff === 1 ? 'Tomorrow'
    : diff === -1 ? 'Yesterday'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  // End-of-day deadlines (23:59) show just the day.
  return isEndOfDay(iso) ? label : `${label}, ${fmtTime(iso)}`
}

export const END_OF_DAY = '23:59'
export const isEndOfDay = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() === 23 && d.getMinutes() === 59
}

/** Date + optional time inputs → ISO (time defaults to 23:59). */
export function deadlineIso(date: string, time: string): string | null {
  return date ? new Date(`${date}T${time || END_OF_DAY}`).toISOString() : null
}

/** ISO string → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${dayStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** <input type="datetime-local"> value → ISO string (or null). */
export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

export const WEEKDAYS_MON_FIRST = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
