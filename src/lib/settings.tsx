import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { ok } from './toast'
import type { Settings } from './types'

interface Ctx {
  settings: Settings | null
  save: (patch: Partial<Omit<Settings, 'user_id'>>) => Promise<boolean>
}

const SettingsContext = createContext<Ctx>({ settings: null, save: async () => false })

export function SettingsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    ;(async () => {
      // First login creates the row with defaults; afterwards this is a no-op.
      const up = await supabase.from('settings').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
      if (!ok(up)) return
      const res = await supabase.from('settings').select('*').eq('user_id', userId).single()
      if (ok(res)) setSettings(res.data as Settings)
    })()
  }, [userId])

  const save = useCallback(
    async (patch: Partial<Omit<Settings, 'user_id'>>) => {
      const res = await supabase
        .from('settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select()
        .single()
      if (!ok(res)) return false
      setSettings(res.data as Settings)
      return true
    },
    [userId],
  )

  return <SettingsContext.Provider value={{ settings, save }}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
