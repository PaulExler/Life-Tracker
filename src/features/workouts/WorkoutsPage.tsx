import { useCallback, useEffect, useState } from 'react'
import { getActiveWorkout, loadExercises, loadRoutines, CATEGORY_LABEL } from '../../lib/workouts'
import type { Exercise, Routine, Workout } from '../../lib/types'
import { ActiveWorkout } from './ActiveWorkout'
import { WorkoutCalendar } from './Calendar'
import { RoutinesView } from './Routines'
import { ProgressView } from './Progress'

type View = 'calendar' | 'routines' | 'progress'

export function WorkoutsPage() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [active, setActive] = useState<Workout | null | undefined>(undefined)
  const [view, setView] = useState<View>('calendar')
  const [editing, setEditing] = useState<Workout | null>(null)

  const reloadExercises = useCallback(() => loadExercises().then(setExercises), [])
  const reloadRoutines = useCallback(() => loadRoutines().then(setRoutines), [])
  const reloadActive = useCallback(() => getActiveWorkout().then(setActive), [])

  useEffect(() => {
    reloadExercises()
    reloadRoutines()
    reloadActive()
  }, [reloadExercises, reloadRoutines, reloadActive])

  if (active === undefined) return <p className="muted">Loading…</p>

  if (editing)
    return (
      <ActiveWorkout
        key={editing.id}
        workout={editing}
        exercises={exercises}
        routines={routines}
        onExercisesChanged={reloadExercises}
        onClose={() => setEditing(null)}
      />
    )

  if (active)
    return (
      <ActiveWorkout
        key={active.id}
        workout={active}
        exercises={exercises}
        routines={routines}
        onExercisesChanged={reloadExercises}
        onClose={reloadActive}
      />
    )

  return (
    <div className="stack">
      <div className="segmented" role="tablist">
        {(['calendar', 'routines', 'progress'] as View[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      {view === 'calendar' && <WorkoutCalendar routines={routines} exercises={exercises} onStarted={reloadActive} onEditDone={setEditing} />}
      {view === 'routines' && (
        <RoutinesView routines={routines} exercises={exercises} onChanged={reloadRoutines} onExercisesChanged={reloadExercises} />
      )}
      {view === 'progress' && <ProgressView exercises={exercises} />}
    </div>
  )
}

/** <select> options: saved routines plus free sessions. Values: "r:<id>" | "free:<category>". */
export function RoutineOptions({ routines }: { routines: Routine[] }) {
  return (
    <>
      {routines.length > 0 && (
        <optgroup label="Routines">
          {routines.map((r) => (
            <option key={r.id} value={`r:${r.id}`}>
              {r.name} ({CATEGORY_LABEL[r.category]})
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Free session">
        <option value="free:lifting">Weightlifting (free)</option>
        <option value="free:bouldering">Bouldering (free)</option>
      </optgroup>
    </>
  )
}
