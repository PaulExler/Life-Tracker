import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ok, toast } from '../../lib/toast'
import { addLog, analyze, forGrams, MEAL_LABEL, MEALS, offByBarcode, offSearch, per100, resizeImage, saveFood, timeFor, type OffProduct } from '../../lib/food'
import type { Analysis, Food, Meal } from '../../lib/types'
import { BarcodeScanner, canScan } from './BarcodeScanner'

const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

export function MealPicker({ meal, onChange }: { meal: Meal; onChange: (m: Meal) => void }) {
  return (
    <div className="row wrap">
      {MEALS.map((m) => (
        <button key={m} type="button" className={`chip ${meal === m ? 'on' : ''}`} onClick={() => onChange(m)} aria-pressed={meal === m}>
          {MEAL_LABEL[m]}
        </button>
      ))}
    </div>
  )
}

interface PanelProps {
  day: Date
  meal: Meal
  setMeal: (m: Meal) => void
  onAdded: () => void
}

// ---------------- Quick: type calories directly ----------------
export function QuickAdd({ day, meal, setMeal, onAdded }: PanelProps) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [grams, setGrams] = useState('')
  const [p, setP] = useState('')
  const [c, setC] = useState('')
  const [f, setF] = useState('')
  const [save, setSave] = useState(false)

  async function add() {
    const row = { name: name.trim() || 'Quick entry', kcal: Number(n(kcal)), grams: n(grams), protein_g: n(p), carbs_g: n(c), fat_g: n(f) }
    if (!(row.kcal >= 0)) return
    let food_id: string | null = null
    if (save && row.grams) {
      const food = await saveFood({ name: row.name, kind: 'custom', default_grams: row.grams, ...per100(row, row.grams) })
      food_id = food?.id ?? null
    }
    if (await addLog({ ...row, meal, logged_at: timeFor(day, meal), source: 'manual', food_id })) {
      setName(''); setKcal(''); setGrams(''); setP(''); setC(''); setF(''); setSave(false)
      onAdded()
    }
  }

  return (
    <div className="card stack">
      <input placeholder="What did you eat? (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="row">
        <label className="grow"><span className="label">kcal</span><input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label className="grow"><span className="label">grams (opt.)</span><input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} /></label>
      </div>
      <div className="row">
        <label className="grow"><span className="label">Protein g</span><input inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></label>
        <label className="grow"><span className="label">Carbs g</span><input inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></label>
        <label className="grow"><span className="label">Fat g</span><input inputMode="decimal" value={f} onChange={(e) => setF(e.target.value)} /></label>
      </div>
      <MealPicker meal={meal} onChange={setMeal} />
      {n(grams) && (
        <label className="row small">
          <input type="checkbox" className="check" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save to my foods for next time
        </label>
      )}
      <button className="primary" disabled={!(Number(n(kcal)) >= 0) || kcal.trim() === ''} onClick={add}>Add</button>
    </div>
  )
}

// ---------------- Search: my foods + Open Food Facts + barcode ----------------
type Pick = { food?: Food; product?: OffProduct }

export function SearchAdd({ day, meal, setMeal, onAdded }: PanelProps) {
  const [foods, setFoods] = useState<Food[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OffProduct[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState(false)
  const [picked, setPicked] = useState<Pick | null>(null)

  useEffect(() => {
    supabase.from('foods').select('*').eq('archived', false).order('name').then((r) => ok(r) && setFoods(r.data as Food[]))
  }, [])

  const mine = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? foods.filter((f) => f.name.toLowerCase().includes(s) || f.brand?.toLowerCase().includes(s)) : foods).slice(0, 30)
  }, [foods, q])

  async function lookup(code: string) {
    setScan(false)
    const own = foods.find((f) => f.barcode === code)
    if (own) return setPicked({ food: own })
    setBusy(true)
    const p = await offByBarcode(code)
    setBusy(false)
    if (p) setPicked({ product: p })
    else toast(`No product found for barcode ${code}. Add it with Quick entry instead.`)
  }

  async function search() {
    const s = q.trim()
    if (!s) return
    if (/^\d{8,14}$/.test(s)) return lookup(s)
    setBusy(true)
    setResults(await offSearch(s))
    setBusy(false)
  }

  const onCode = useCallback((c: string) => void lookup(c), [foods]) // eslint-disable-line react-hooks/exhaustive-deps

  if (picked)
    return <GramsForm pick={picked} day={day} meal={meal} setMeal={setMeal} onBack={() => setPicked(null)} onAdded={onAdded} />

  return (
    <div className="card stack">
      {scan && <BarcodeScanner onCode={onCode} onClose={() => setScan(false)} />}
      <form className="row" onSubmit={(e) => { e.preventDefault(); search() }}>
        <input className="grow" placeholder="Search food or type a barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        <button disabled={busy || !q.trim()}>{busy ? '…' : 'Search'}</button>
      </form>
      {canScan && <button onClick={() => setScan(true)}>📷 Scan barcode</button>}

      {mine.length > 0 && (
        <>
          <h2>My foods</h2>
          <ul className="list compact">
            {mine.map((f) => (
              <li key={f.id} className="item row clickable" onClick={() => setPicked({ food: f })}>
                <div className="grow">
                  <div className="title">{f.name}</div>
                  <div className="small muted">{f.brand ? `${f.brand} · ` : ''}{Math.round(f.kcal_100g)} kcal / 100 g{f.kind === 'recipe' ? ' · recipe' : ''}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {results && (
        <>
          <h2>Open Food Facts</h2>
          {results.length === 0 ? (
            <p className="small muted">Nothing found. Try another spelling, or use Quick / Photo.</p>
          ) : (
            <ul className="list compact">
              {results.map((p, i) => (
                <li key={`${p.barcode}-${i}`} className="item row clickable" onClick={() => setPicked({ product: p })}>
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="small muted">{p.brand ? `${p.brand} · ` : ''}{Math.round(p.kcal_100g)} kcal / 100 g</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!results && mine.length === 0 && <p className="small muted">Foods you log from search, barcode or recipes are remembered here.</p>}
    </div>
  )
}

function GramsForm({ pick, day, meal, setMeal, onBack, onAdded }: { pick: Pick; onBack: () => void } & PanelProps) {
  const base = pick.food ?? pick.product!
  const [grams, setGrams] = useState(String(base.default_grams ?? 100))
  const g = Number(n(grams)) || 0
  const nut = forGrams(base, g)

  async function add() {
    if (!(g > 0)) return
    let food_id = pick.food?.id ?? null
    if (pick.product) {
      // Remember the product so it shows under "My foods" next time.
      const p = pick.product
      const existing = p.barcode ? await supabase.from('foods').select('id').eq('barcode', p.barcode).maybeSingle() : null
      food_id =
        existing?.data?.id ??
        (await saveFood({
          name: p.name, brand: p.brand, barcode: p.barcode || null, kind: 'product', kcal_100g: p.kcal_100g,
          protein_100g: p.protein_100g, carbs_100g: p.carbs_100g, fat_100g: p.fat_100g, default_grams: p.default_grams,
        }))?.id ??
        null
    }
    const name = base.brand ? `${base.name} (${base.brand})` : base.name
    if (await addLog({ name, grams: g, ...nut, meal, logged_at: timeFor(day, meal), source: pick.product ? 'barcode' : 'food', food_id })) onAdded()
  }

  return (
    <div className="card stack">
      <div>
        <div className="title">{base.name}</div>
        <div className="small muted">{base.brand ? `${base.brand} · ` : ''}{Math.round(base.kcal_100g)} kcal / 100 g</div>
      </div>
      <label>
        <span className="label">Amount (g)</span>
        <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} autoFocus />
      </label>
      <div className="macro-row">
        <span><strong>{nut.kcal}</strong> kcal</span>
        <span>P {nut.protein_g ?? '–'} g</span>
        <span>C {nut.carbs_g ?? '–'} g</span>
        <span>F {nut.fat_g ?? '–'} g</span>
      </div>
      <MealPicker meal={meal} onChange={setMeal} />
      <div className="row">
        <button onClick={onBack}>Back</button>
        <button className="primary grow" disabled={!(g > 0)} onClick={add}>Add</button>
      </div>
    </div>
  )
}

// ---------------- AI: photo + weight, or recipe + weight ----------------
export function AnalyzeAdd({ mode, day, meal, setMeal, onAdded }: PanelProps & { mode: 'photo' | 'recipe' }) {
  const [image, setImage] = useState<{ data: string; mediaType: string; preview: string } | null>(null)
  const [recipe, setRecipe] = useState('')
  const [grams, setGrams] = useState('')
  const [total, setTotal] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)

  async function pickFile(file?: File) {
    if (!file) return
    try {
      setImage(await resizeImage(file))
    } catch {
      toast('Could not read that image.')
    }
  }

  async function run() {
    setBusy(true)
    const r =
      mode === 'photo'
        ? await analyze({ mode, image: image!.data, mediaType: image!.mediaType, grams: n(grams), note: note.trim() || undefined })
        : await analyze({ mode, recipe, grams: n(grams), totalGrams: n(total) })
    setBusy(false)
    if (r) setResult(r)
  }

  if (result)
    return (
      <AnalysisResult
        result={result}
        mode={mode}
        recipeText={recipe}
        day={day}
        meal={meal}
        setMeal={setMeal}
        onBack={() => setResult(null)}
        onAdded={onAdded}
      />
    )

  return (
    <div className="card stack">
      {mode === 'photo' ? (
        <>
          <label className="photo-pick">
            {image ? <img src={image.preview} alt="Your meal" /> : <span>📷 Take or choose a photo</span>}
            <input type="file" accept="image/*" capture="environment" onChange={(e) => pickFile(e.target.files?.[0])} hidden />
          </label>
          <label>
            <span className="label">Weight on the scale (g) — makes it much more accurate</span>
            <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="e.g. 450" />
          </label>
          <input placeholder="Extra info (optional), e.g. “fried in olive oil”" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      ) : (
        <>
          <textarea
            rows={7}
            placeholder={'Paste or type the recipe with amounts, e.g.\n200 g spaghetti\n300 g minced beef\n1 onion\n400 g passata\n2 tbsp olive oil'}
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
          />
          <div className="row">
            <label className="grow">
              <span className="label">Your portion (g)</span>
              <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
            </label>
            <label className="grow">
              <span className="label">Whole dish cooked (g, opt.)</span>
              <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
            </label>
          </div>
        </>
      )}
      <button className="primary" disabled={busy || (mode === 'photo' ? !image : !recipe.trim())} onClick={run}>
        {busy ? 'Analysing… (10–30 s)' : 'Analyse'}
      </button>
      <p className="small muted">Estimated by Claude. Always shown with a range — check it looks right before adding.</p>
    </div>
  )
}

function AnalysisResult({
  result,
  mode,
  recipeText,
  day,
  meal,
  setMeal,
  onBack,
  onAdded,
}: { result: Analysis; mode: 'photo' | 'recipe'; recipeText: string; onBack: () => void } & PanelProps) {
  const t = result.total
  const [name, setName] = useState(result.dish_name)
  const [grams, setGrams] = useState(String(Math.round(t.grams)))
  const [kcal, setKcal] = useState(String(Math.round(t.kcal)))
  const [save, setSave] = useState(mode === 'recipe')
  const g = Number(n(grams)) || 0
  // Editing the weight scales everything; editing kcal overrides just the calories.
  const scale = t.grams > 0 && g > 0 ? g / t.grams : 1
  const r1 = (x: number) => Math.round(x * scale * 10) / 10
  const macros = { protein_g: r1(t.protein_g), carbs_g: r1(t.carbs_g), fat_g: r1(t.fat_g) }
  const scaledKcal = Math.round(t.kcal * scale)
  const kcalVal = Number(n(kcal)) || 0

  function onGrams(v: string) {
    setGrams(v)
    const gg = Number(n(v)) || 0
    if (t.grams > 0 && gg > 0) setKcal(String(Math.round((t.kcal * gg) / t.grams)))
  }

  async function add() {
    let food_id: string | null = null
    if (save && g > 0) {
      const food = await saveFood({
        name: name.trim() || result.dish_name,
        kind: mode === 'recipe' ? 'recipe' : 'custom',
        default_grams: g,
        notes: mode === 'recipe' ? recipeText.slice(0, 2000) : null,
        ...per100({ kcal: kcalVal, ...macros }, g),
      })
      food_id = food?.id ?? null
    }
    const ok = await addLog({
      name: name.trim() || result.dish_name,
      grams: g || null,
      kcal: kcalVal,
      ...macros,
      kcal_low: Math.round(t.kcal_low * scale),
      kcal_high: Math.round(t.kcal_high * scale),
      meal,
      logged_at: timeFor(day, meal),
      source: mode,
      food_id,
      details: result,
    })
    if (ok) onAdded()
  }

  return (
    <div className="card stack">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <div className="estimate">
        <div className="big">{kcalVal} kcal</div>
        <div className="small muted">
          range {Math.round(t.kcal_low * scale)}–{Math.round(t.kcal_high * scale)} kcal · confidence {result.confidence}
          {kcalVal !== scaledKcal && ' · edited'}
        </div>
      </div>
      <div className="macro-row">
        <span>P {macros.protein_g} g</span>
        <span>C {macros.carbs_g} g</span>
        <span>F {macros.fat_g} g</span>
      </div>
      <ul className="list compact">
        {result.items.map((it, i) => (
          <li key={i} className="item row">
            <span className="grow">{it.name}</span>
            <span className="small muted">{Math.round(it.grams * scale)} g · {Math.round(it.kcal * scale)} kcal</span>
          </li>
        ))}
      </ul>
      {result.notes && <p className="small muted">{result.notes}</p>}
      <div className="row">
        <label className="grow"><span className="label">Grams</span><input inputMode="decimal" value={grams} onChange={(e) => onGrams(e.target.value)} /></label>
        <label className="grow"><span className="label">kcal</span><input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
      </div>
      <MealPicker meal={meal} onChange={setMeal} />
      <label className="row small">
        <input type="checkbox" className="check" checked={save} onChange={(e) => setSave(e.target.checked)} />
        Save to my foods {mode === 'recipe' ? '(recipe, per 100 g — log it again by weight later)' : 'for next time'}
      </label>
      <div className="row">
        <button onClick={onBack}>Back</button>
        <button className="primary grow" disabled={!(kcalVal >= 0)} onClick={add}>Add to log</button>
      </div>
    </div>
  )
}
