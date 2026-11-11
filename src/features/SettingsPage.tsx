import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { toast } from '../lib/toast'
import { disconnect, subscribe, syncNow, type GcalState } from '../lib/gcal'
import { ExerciseSettings } from './workouts/ExerciseSettings'

export function SettingsPage({ email }: { email: string }) {
  const { settings, save } = useSettings()
  const [water, setWater] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')

  useEffect(() => {
    if (!settings) return
    setWater(String(settings.water_goal_ml))
    setKcal(String(settings.calorie_goal))
    setProtein(settings.protein_goal_g == null ? '' : String(settings.protein_goal_g))
  }, [settings])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const done = await save({
      water_goal_ml: Number(water) || 2500,
      calorie_goal: Number(kcal) || 2500,
      protein_goal_g: protein ? Number(protein) : null,
    })
    if (done) toast('Saved')
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={submit}>
        <h3>Daily goals</h3>
        <label>
          <span className="label">Water (ml)</span>
          <input type="number" inputMode="numeric" min={0} value={water} onChange={(e) => setWater(e.target.value)} />
        </label>
        <label>
          <span className="label">Calories (kcal)</span>
          <input type="number" inputMode="numeric" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} />
        </label>
        <label>
          <span className="label">Protein (g, optional)</span>
          <input type="number" inputMode="numeric" min={0} value={protein} onChange={(e) => setProtein(e.target.value)} />
        </label>
        <button className="primary">Save</button>
      </form>
      <CalendarSettings />
      <ExerciseSettings />
      <div className="card stack">
        <div className="small muted">Signed in as {email}</div>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <p className="small muted center">Coming next: food &amp; calories, spending.</p>
    </div>
  )
}

function CalendarSettings() {
  const [s, setS] = useState<GcalState | null>(null)
  useEffect(() => subscribe(setS), [])
  if (!s) return null
  return (
    <div className="card stack">
      <h3>Google Calendar</h3>
      {!s.configured ? (
        <p className="small muted">Not set up yet — a Google Client ID needs to be added to the app.</p>
      ) : s.connected ? (
        <>
          <p className="small muted">
            Planned workouts, task deadlines and habits with a time are added to your Google Calendar on this device, with
            reminders the evening before (20:00) and 1 hour before.
          </p>
          <div className="row">
            <button className="grow" onClick={() => syncNow()} disabled={s.syncing}>{s.syncing ? 'Syncing…' : 'Sync now'}</button>
            <button onClick={() => disconnect()}>Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">Add planned workouts, task deadlines and habits to your Google Calendar so Google reminds you.</p>
          <button className="primary" onClick={() => syncNow()}>Connect Google Calendar</button>
        </>
      )}
    </div>
  )
}
