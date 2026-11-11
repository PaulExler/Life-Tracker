export interface Task {
  id: string
  title: string
  notes: string | null
  due_at: string | null
  done_at: string | null
  created_at: string
}

export interface Habit {
  id: string
  name: string
  days: number[]
  archived: boolean
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
