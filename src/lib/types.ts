export interface Task {
  id: string
  title: string
  notes: string | null
  due_at: string | null
  done_at: string | null
  gcal_event_id: string | null
  created_at: string
}

export interface Habit {
  id: string
  name: string
  days: number[]
  time: string | null
  archived: boolean
  created_at: string
}

export type Category = 'lifting' | 'bouldering'
export type Measure = 'reps' | 'time'

export interface Exercise {
  id: string
  name: string
  category: Category
  measure: Measure
  archived: boolean
}

export interface RoutineItem {
  exercise_id: string
  sets: number
  target: number | null
}

export interface Routine {
  id: string
  name: string
  category: Category
  items: RoutineItem[]
  archived: boolean
}

export interface Workout {
  id: string
  category: Category
  routine_id: string | null
  title: string
  planned_at: string | null
  duration_min: number
  started_at: string | null
  finished_at: string | null
  notes: string | null
  top_grade: string | null
  gcal_event_id: string | null
}

export interface WorkoutSet {
  id: string
  workout_id: string
  exercise_id: string
  set_no: number
  reps: number | null
  weight_kg: number | null
  duration_s: number | null
  created_at: string
}

export interface HabitLog {
  id: string
  habit_id: string
  day: string
}

export interface WaterLog {
  id: string
  amount_ml: number
  logged_at: string
}

export interface Settings {
  user_id: string
  water_goal_ml: number
  calorie_goal: number
  protein_goal_g: number | null
}
