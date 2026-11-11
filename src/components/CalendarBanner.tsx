import { useEffect, useState } from 'react'
import { subscribe, syncNow, type GcalState } from '../lib/gcal'

/** Shown when changes are waiting to be pushed to Google Calendar and a tap is needed. */
export function CalendarBanner() {
  const [s, setS] = useState<GcalState | null>(null)
  useEffect(() => subscribe(setS), [])
  if (!s || !s.connected || (s.pending === 0 && !s.syncing)) return null
  return (
    <button className="banner" onClick={() => syncNow()} disabled={s.syncing}>
      {s.syncing ? 'Syncing with Google Calendar…' : `📅 ${s.pending} change${s.pending === 1 ? '' : 's'} not in Google Calendar yet — tap to sync`}
    </button>
  )
}
