import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg({ text: error.message, error: true })
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
      })
      setMsg(error ? { text: error.message, error: true } : { text: 'Check your inbox to confirm your email, then sign in.' })
      if (!error) setMode('in')
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <h1>Life Tracker</h1>
        <p className="muted">{mode === 'in' ? 'Sign in to sync across your devices.' : 'Create your account.'}</p>
        <input type="email" autoComplete="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder="Password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        {msg && <p className={msg.error ? 'danger' : 'muted'}>{msg.text}</p>}
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'First time? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
