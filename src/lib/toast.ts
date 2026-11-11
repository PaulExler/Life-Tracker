type Listener = (msg: string) => void
const listeners = new Set<Listener>()

export function onToast(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function toast(msg: string) {
  listeners.forEach((l) => l(msg))
}

/** Returns true if a Supabase response succeeded; otherwise shows the error. */
export function ok(res: { error: { message: string } | null }): boolean {
  if (res.error) {
    toast(res.error.message)
    return false
  }
  return true
}
