import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { onToast } from './lib/toast'
import { SettingsProvider } from './lib/settings'
import { Login } from './features/Login'
import { TaskList } from './features/Tasks'
import { HabitsPage, TodayHabits } from './features/Habits'
import { WaterCard, WaterPage } from './features/Water'
import { SettingsPage } from './features/SettingsPage'
import { CheckIcon, DropIcon, GearIcon, RepeatIcon, SunIcon } from './components/Icons'

const TABS = [
  { id: 'today', label: 'Today', icon: <SunIcon /> },
  { id: 'tasks', label: 'Tasks', icon: <CheckIcon /> },
  { id: 'habits', label: 'Habits', icon: <RepeatIcon /> },
  { id: 'water', label: 'Water', icon: <DropIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> },
] as const
type TabId = (typeof TABS)[number]['id']

const tabFromHash = (): TabId => {
  const h = location.hash.slice(1)
  return (TABS.find((t) => t.id === h)?.id ?? 'today') as TabId
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const f = () => setTab(tabFromHash())
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    return onToast((m) => {
      setToastMsg(m)
      clearTimeout(timer)
      timer = setTimeout(() => setToastMsg(null), 3500)
    })
  }, [])

  const toastEl = toastMsg && <div className="toast" role="status">{toastMsg}</div>

  if (!ready) return null
  if (!session) return <>{<Login />}{toastEl}</>

  const title = TABS.find((t) => t.id === tab)!.label
  let page: ReactNode
  switch (tab) {
    case 'today':
      page = <TodayPage />
      break
    case 'tasks':
      page = <TaskList />
      break
    case 'habits':
      page = <HabitsPage />
      break
    case 'water':
      page = <WaterPage />
      break
    case 'settings':
      page = <SettingsPage email={session.user.email ?? ''} />
      break
  }

  return (
    <SettingsProvider userId={session.user.id}>
      <div className="app">
        <header className="top">
          <h1>{tab === 'today' ? new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : title}</h1>
        </header>
        <main>{page}</main>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.id === tab ? 'active' : ''} aria-current={t.id === tab ? 'page' : undefined}>
              {t.icon}
              <span>{t.label}</span>
            </a>
          ))}
        </nav>
        {toastEl}
      </div>
    </SettingsProvider>
  )
}

function TodayPage() {
  return (
    <div className="stack">
      <Section title="Water"><WaterCard /></Section>
      <Section title="Habits"><TodayHabits /></Section>
      <Section title="Due today & overdue"><TaskList mode="today" /></Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack">
      <h2>{title}</h2>
      {children}
    </section>
  )
}
