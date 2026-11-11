import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { toast } from '../lib/toast'

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
      <div className="card stack">
        <div className="small muted">Signed in as {email}</div>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <p className="small muted center">Coming next: workouts &amp; Google Calendar, food, spending.</p>
    </div>
  )
}
