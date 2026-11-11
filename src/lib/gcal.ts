/**
 * Google Calendar sync.
 *
 * Items in the database carry `gcal_dirty` (needs pushing) and `gcal_event_id`.
 * Whenever something changes, call `changed()`. If this device has a valid Google
 * token the dirty rows are pushed right away; otherwise the app shows a
 * "Sync to Google Calendar" banner (Google needs a tap to hand out a new token).
 */
import { supabase } from './supabase'
import { toast } from './toast'
import { dayStr } from './date'

// From Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web).
// It is public by design (like the Supabase publishable key).
export const GOOGLE_CLIENT_ID = ''

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const LS_TOKEN = 'gcal_token'
const LS_ON = 'gcal_on'
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

// ---------- small state store for the UI ----------
export interface GcalState {
  configured: boolean
  connected: boolean // user switched sync on for this device
  pending: number
  syncing: boolean
}
let state: GcalState = {
  configured: !!GOOGLE_CLIENT_ID,
  connected: lsGet(LS_ON) === '1',
  pending: 0,
  syncing: false,
}
const subs = new Set<(s: GcalState) => void>()
export function subscribe(f: (s: GcalState) => void) {
  subs.add(f)
  f(state)
  return () => {
    subs.delete(f)
  }
}
function setState(p: Partial<GcalState>) {
  state = { ...state, ...p }
  subs.forEach((f) => f(state))
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* storage unavailable */
  }
}

// ---------- Google sign-in (token client) ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any
  }
}
let token: { v: string; exp: number } | null = (() => {
  try {
    return JSON.parse(lsGet(LS_TOKEN) ?? 'null')
  } catch {
    return null
  }
})()
const validToken = () => (token && token.exp > Date.now() + 60_000 ? token.v : null)

let client: any = null
let resolveAuth: ((ok: boolean) => void) | null = null

/** Load Google's script early, so a later tap can open the consent popup immediately. */
export function initGoogle() {
  if (!GOOGLE_CLIENT_ID || document.getElementById('gis')) return
  const s = document.createElement('script')
  s.id = 'gis'
  s.src = 'https://accounts.google.com/gsi/client'
  s.async = true
  s.onload = () => {
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r: any) => {
        if (r.access_token) {
          token = { v: r.access_token, exp: Date.now() + Number(r.expires_in) * 1000 }
          lsSet(LS_TOKEN, JSON.stringify(token))
          lsSet(LS_ON, '1')
          setState({ connected: true })
        }
        resolveAuth?.(!!r.access_token)
        resolveAuth = null
      },
      error_callback: () => {
        resolveAuth?.(false)
        resolveAuth = null
      },
    })
  }
  document.head.appendChild(s)
}

/** Must be called straight from a tap/click (browsers block popups otherwise). */
function authorize(): Promise<boolean> {
  if (!client) {
    toast('Google is still loading — try again in a second.')
    return Promise.resolve(false)
  }
  return new Promise((res) => {
    resolveAuth = res
    client.requestAccessToken({ prompt: state.connected ? '' : 'consent' })
  })
}

export function disconnect() {
  if (token) window.google?.accounts.oauth2.revoke(token.v, () => {})
  token = null
  lsSet(LS_TOKEN, null)
  lsSet(LS_ON, null)
  setState({ connected: false, pending: 0 })
}

/** Tap handler for "Connect" / "Sync now". */
export async function syncNow() {
  if (!validToken() && !(await authorize())) return
  await syncAll()
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Call after any change to tasks, habits or workouts. */
export function changed() {
  if (!state.configured || !state.connected) return
  clearTimeout(timer)
  timer = setTimeout(() => (validToken() ? syncAll() : refreshPending()), 600)
}

export async function refreshPending() {
  if (!state.configured || !state.connected) return setState({ pending: 0 })
  const head = { count: 'exact' as const, head: true }
  const [t, h, w, d] = await Promise.all([
    supabase.from('tasks').select('id', head).eq('gcal_dirty', true).or('due_at.not.is.null,gcal_event_id.not.is.null'),
    supabase.from('habits').select('id', head).eq('gcal_dirty', true).or('time.not.is.null,gcal_event_id.not.is.null'),
    supabase.from('workouts').select('id', head).eq('gcal_dirty', true).or('planned_at.not.is.null,gcal_event_id.not.is.null'),
    supabase.from('gcal_deletions').select('id', head),
  ])
  setState({ pending: (t.count ?? 0) + (h.count ?? 0) + (w.count ?? 0) + (d.count ?? 0) })
}

/** On app start: push anything outstanding if we still have a token. */
export function startup() {
  initGoogle()
  if (!state.configured || !state.connected) return
  if (validToken()) syncAll()
  else refreshPending()
}

// ---------- Calendar API ----------
class GError extends Error {
  constructor(public status: number) {
    super(`Google Calendar error ${status}`)
  }
}
async function gapi(tok: string, method: string, path = '', body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new GError(r.status)
  return r.status === 204 ? null : r.json()
}
const gone = (e: unknown) => e instanceof GError && (e.status === 404 || e.status === 410)

// ---------- event builders ----------
const localIso = (d: Date) =>
  `${dayStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
const at = (d: Date) => ({ dateTime: localIso(d), timeZone: TZ })
const MARK = { private: { lifeTracker: '1' } }

/** Popup the evening before at 20:00 and 1 hour before. */
function twoReminders(start: Date) {
  const eve = new Date(start)
  eve.setDate(eve.getDate() - 1)
  eve.setHours(20, 0, 0, 0)
  return {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 60 },
      { method: 'popup', minutes: Math.round((start.getTime() - eve.getTime()) / 60000) },
    ],
  }
}

type Row = Record<string, any>

function taskEvent(t: Row) {
  if (!t.due_at || t.done_at) return null
  const start = new Date(t.due_at)
  return {
    summary: `⏰ ${t.title}`,
    description: `${t.notes ? t.notes + '\n\n' : ''}Deadline — from Life Tracker`,
    start: at(start),
    end: at(new Date(start.getTime() + 15 * 60000)),
    reminders: twoReminders(start),
    extendedProperties: MARK,
  }
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
function habitEvent(h: Row) {
  if (h.archived || !h.time || !h.days?.length) return null
  const [hh, mm] = String(h.time).split(':').map(Number)
  const start = new Date()
  start.setHours(hh, mm, 0, 0)
  while (!h.days.includes(start.getDay())) start.setDate(start.getDate() + 1)
  return {
    summary: `🔁 ${h.name}`,
    description: 'Habit — from Life Tracker',
    start: at(start),
    end: at(new Date(start.getTime() + 30 * 60000)),
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${(h.days as number[]).map((d) => BYDAY[d]).join(',')}`],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: MARK,
  }
}

function workoutEvent(w: Row) {
  if (!w.planned_at) return null
  const start = new Date(w.planned_at)
  const icon = w.category === 'bouldering' ? '🧗' : '🏋️'
  return {
    summary: `${w.finished_at ? '✓ ' : ''}${icon} ${w.title}`,
    description: 'Workout — from Life Tracker',
    start: at(start),
    end: at(new Date(start.getTime() + (w.duration_min || 60) * 60000)),
    reminders: w.finished_at ? { useDefault: false, overrides: [] } : twoReminders(start),
    extendedProperties: MARK,
  }
}

const TABLES: [string, (r: Row) => object | null][] = [
  ['tasks', taskEvent],
  ['habits', habitEvent],
  ['workouts', workoutEvent],
]

// ---------- sync ----------
let running = false
async function syncAll() {
  const tok = validToken()
  if (!tok || running) return
  running = true
  setState({ syncing: true })
  let failed = 0
  try {
    const dels = await supabase.from('gcal_deletions').select('id,event_id')
    for (const d of dels.data ?? []) {
      try {
        await gapi(tok, 'DELETE', `/${encodeURIComponent(d.event_id)}`)
      } catch (e) {
        if (!gone(e)) throw e
      }
      await supabase.from('gcal_deletions').delete().eq('id', d.id)
    }

    for (const [table, build] of TABLES) {
      const res = await supabase.from(table).select('*').eq('gcal_dirty', true)
      for (const row of res.data ?? []) {
        try {
          const ev = build(row)
          let id: string | null = row.gcal_event_id
          if (ev) {
            if (id) {
              try {
                await gapi(tok, 'PUT', `/${encodeURIComponent(id)}`, ev)
              } catch (e) {
                if (gone(e)) id = null
                else throw e
              }
            }
            if (!id) id = (await gapi(tok, 'POST', '', ev)).id
          } else if (id) {
            try {
              await gapi(tok, 'DELETE', `/${encodeURIComponent(id)}`)
            } catch (e) {
              if (!gone(e)) throw e
            }
            id = null
          }
          await supabase.from(table).update({ gcal_event_id: id, gcal_dirty: false }).eq('id', row.id)
        } catch (e) {
          if (e instanceof GError && e.status === 401) throw e
          failed++
        }
      }
    }
  } catch (e) {
    if (e instanceof GError && e.status === 401) {
      token = null
      lsSet(LS_TOKEN, null)
    } else {
      toast('Google Calendar sync failed — will retry.')
    }
  } finally {
    running = false
    setState({ syncing: false })
    await refreshPending()
  }
  if (failed) toast(`${failed} item(s) could not be added to Google Calendar.`)
}

/** Remember an event to remove from Google when its app item is deleted. */
export async function forgetEvent(eventId: string | null) {
  if (eventId) await supabase.from('gcal_deletions').insert({ event_id: eventId })
}
