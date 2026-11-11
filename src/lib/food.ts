import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ok, toast } from './toast'
import type { Analysis, Food, FoodLog, Meal } from './types'

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
const MEAL_TIME: Record<Meal, [number, number]> = { breakfast: [8, 0], lunch: [12, 30], dinner: [19, 0], snack: [16, 0] }

export function defaultMeal(d = new Date()): Meal {
  const h = d.getHours() + d.getMinutes() / 60
  if (h < 10.5) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 17) return 'snack'
  if (h < 21.5) return 'dinner'
  return 'snack'
}

/** Timestamp for a new entry on `day`: now if day is today, else a typical time for the meal. */
export function timeFor(day: Date, meal: Meal): string {
  const now = new Date()
  if (day.toDateString() === now.toDateString()) return now.toISOString()
  const d = new Date(day)
  d.setHours(...MEAL_TIME[meal], 0, 0)
  return d.toISOString()
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Nutrition for `grams` of a food stored per 100 g. */
export function forGrams(f: Pick<Food, 'kcal_100g' | 'protein_100g' | 'carbs_100g' | 'fat_100g'>, grams: number) {
  const k = grams / 100
  return {
    kcal: Math.round(Number(f.kcal_100g) * k),
    protein_g: f.protein_100g == null ? null : r1(Number(f.protein_100g) * k),
    carbs_g: f.carbs_100g == null ? null : r1(Number(f.carbs_100g) * k),
    fat_g: f.fat_100g == null ? null : r1(Number(f.fat_100g) * k),
  }
}

/** Per-100 g values from a total for `grams`. */
export function per100(n: { kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null }, grams: number) {
  const k = 100 / grams
  return {
    kcal_100g: r1(n.kcal * k),
    protein_100g: n.protein_g == null ? null : r1(n.protein_g * k),
    carbs_100g: n.carbs_g == null ? null : r1(n.carbs_g * k),
    fat_100g: n.fat_g == null ? null : r1(n.fat_g * k),
  }
}

export async function addLog(row: Partial<FoodLog> & { name: string; kcal: number; meal: Meal; logged_at: string }) {
  return ok(await supabase.from('food_logs').insert(row))
}

export async function saveFood(row: Partial<Food> & { name: string; kcal_100g: number }): Promise<Food | null> {
  const res = await supabase.from('foods').insert(row).select().single()
  return ok(res) ? (res.data as Food) : null
}

// ---------- Open Food Facts (free product database) ----------
export interface OffProduct {
  barcode: string
  name: string
  brand: string | null
  kcal_100g: number
  protein_100g: number | null
  carbs_100g: number | null
  fat_100g: number | null
  default_grams: number | null
}

const OFF_FIELDS = 'code,product_name,product_name_en,product_name_de,brands,nutriments,serving_quantity'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromOff(p: any): OffProduct | null {
  const n = p?.nutriments ?? {}
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null)
  const name = p?.product_name || p?.product_name_en || p?.product_name_de
  if (kcal == null || !name) return null
  const num = (v: unknown) => (v == null || v === '' ? null : r1(Number(v)))
  return {
    barcode: String(p.code ?? ''),
    name: String(name).trim(),
    brand: p.brands ? String(p.brands).split(',')[0].trim() : null,
    kcal_100g: r1(Number(kcal)),
    protein_100g: num(n.proteins_100g),
    carbs_100g: num(n.carbohydrates_100g),
    fat_100g: num(n.fat_100g),
    default_grams: Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : null,
  }
}

export async function offByBarcode(code: string): Promise<OffProduct | null> {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`)
    if (!r.ok) return null
    const j = await r.json()
    return j.status === 1 ? fromOff(j.product) : null
  } catch {
    toast('Could not reach the product database.')
    return null
  }
}

export async function offSearch(q: string): Promise<OffProduct[]> {
  try {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
      `&search_simple=1&action=process&json=1&page_size=20&sort_by=unique_scans_n&fields=${OFF_FIELDS}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json()
    return (j.products ?? []).map(fromOff).filter(Boolean) as OffProduct[]
  } catch {
    toast('Product search is not available right now.')
    return []
  }
}

// ---------- AI analysis (Supabase Edge Function → Claude) ----------
/** Shrink a camera photo to ≤1280 px JPEG and return base64 (no data: prefix). */
export async function resizeImage(file: File, max = 1280): Promise<{ data: string; mediaType: string; preview: string }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { data: url.split(',')[1], mediaType: 'image/jpeg', preview: url }
}

export async function analyze(body: Record<string, unknown>): Promise<Analysis | null> {
  const { data, error } = await supabase.functions.invoke('analyze-food', { body })
  if (error) {
    let msg = error.message
    if (error instanceof FunctionsHttpError) {
      try {
        msg = (await error.context.json()).error ?? msg
      } catch {
        /* keep default message */
      }
    }
    if (/not found|404/i.test(msg)) msg = 'The analysis function is not set up in Supabase yet.'
    toast(msg)
    return null
  }
  return data as Analysis
}
