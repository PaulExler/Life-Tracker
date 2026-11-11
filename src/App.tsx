import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { onToast } from './lib/toast'
import { SettingsProvider } from './lib/settings'
import { startup as startCalendar } from './lib/gcal'
import { Login } from './features/Login'
import { TaskList } from './features/Tasks'
import { HabitsPage, TodayHabits } from './features/Habits'
import { WaterCard } from './features/Water'
import { FoodPage, TodayCalories } from './features/food/FoodPage'
import { MoneyPage, TodayMoney } from './features/money/MoneyPage'
import { SettingsPage } from './features/SettingsPage'
import { WorkoutsPage } from './features/workouts/WorkoutsPage'
import { TodayWorkouts } from './features/workouts/TodayWorkouts'
import { CalendarBanner } from './components/CalendarBanner'
import { CheckIcon, DumbbellIcon, FoodIcon, GearIcon, RepeatIcon, SunIcon, WalletIcon } from './components/Icons'

const TABS = [
  { id: 'today', label: 'Today', icon: <SunIcon /> },
  { id: 'workouts', label: 'Workouts', icon: <DumbbellIcon /> },
  { id: 'food', label: 'Food', icon: <FoodIcon /> },
  { id: 'tasks', label: 'Tasks', icon: <CheckIcon /> },
  { id: 'habits', label: 'Habits', icon: <RepeatIcon /> },
  { id: 'money', label: 'Money', icon: <WalletIcon /> },
] as const
type TabId = (typeof TABS)[number]['id'] | 'settings'

const tabFromHash = (): TabId => {
  const h = location.hash.slice(1)
  if (h === 'settings') return 'settings'
  if (h === 'water') return 'food'
  return TABS.find((t) => t.id === h)?.id ?? 'today'
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

  const userId = session?.user.id
  useEffect(() => {
    if (userId) startCalendar()
  }, [userId])

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

  let page: ReactNode
  let title: string
  switch (tab) {
    case 'today':
      title = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
      page = <TodayPage />
      break
    case 'workouts':
      title = 'Workouts'
      page = <WorkoutsPage />
      break
    case 'tasks':
      title = 'Tasks'
      page = <TaskList />
      break
    case 'habits':
      title = 'Habits'
      page = <HabitsPage />
      break
    case 'food':
      title = 'Food'
      page = <FoodPage />
      break
    case 'money':
      title = 'Money'
      page = <MoneyPage />
      break
    case 'settings':
      title = 'Settings'
      page = <SettingsPage email={session.user.email ?? ''} />
      break
  }

  return (
    <SettingsProvider userId={session.user.id}>
      <div className="app">
        <header className="top row">
          <h1 className="grow">{title}</h1>
          <a href="#settings" className={`icon-link ${tab === 'settings' ? 'active' : ''}`} aria-label="Settings">
            <GearIcon />
          </a>
        </header>
        <CalendarBanner />
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
      <Section title="Workout"><TodayWorkouts /></Section>
      <Section title="Calories"><TodayCalories /></Section>
      <Section title="Water"><WaterCard /></Section>
      <Section title="Habits"><TodayHabits /></Section>
      <Section title="Due today & overdue"><TaskList mode="today" /></Section>
      <Section title="Money"><TodayMoney /></Section>
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
