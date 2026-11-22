// Supabase Edge Function: analyze-food
// Estimates nutrition from a food photo + weight, or from a recipe + portion weight, using Claude.
// Secret required: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
// Keep "Verify JWT" ON so only signed-in users of the app can call it.
import Anthropic from 'npm:@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
// Optional secret FOOD_MODEL switches the model without changing code (e.g. claude-opus-5-5 for more accuracy).
const MODEL = Deno.env.get('FOOD_MODEL') || 'claude-sonnet-5-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const num = { type: 'number' }
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dish_name', 'items', 'total', 'confidence', 'notes'],
  properties: {
    dish_name: { type: 'string', description: 'Short name for the whole meal' },
    items: {
      type: 'array',
      description: 'Components of the portion that was eaten, grams summing to the eaten weight',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
        properties: { name: { type: 'string' }, grams: num, kcal: num, protein_g: num, carbs_g: num, fat_g: num },
      },
    },
    total: {
      type: 'object',
      additionalProperties: false,
      required: ['grams', 'kcal', 'kcal_low', 'kcal_high', 'protein_g', 'carbs_g', 'fat_g'],
      properties: { grams: num, kcal: num, kcal_low: num, kcal_high: num, protein_g: num, carbs_g: num, fat_g: num },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string', description: 'One or two short sentences: assumptions made, what could change the estimate' },
  },
}

const SYSTEM = `You are a careful nutrition estimator for a personal calorie tracker.
Return your estimate for the portion the user actually ate.
- Use standard nutrition data (USDA / European food tables). Use cooked values for cooked food.
- If the user gives a weight, the item grams must add up to that weight; scale everything to it.
- Hidden fats (oil, butter, sauces, dressings) are the main source of error: include a plausible amount and mention it in notes.
- total.kcal is your best estimate; kcal_low and kcal_high give a realistic range around it (wider when unsure).
- Round kcal to whole numbers and grams/macros to one decimal.
- Write names and notes in English.`

const UA = { 'User-Agent': 'LifeTracker/0.1 (personal app)' }

async function searchOff(q: string) {
  const r = await fetch(
    `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=de,en&page_size=20` +
      `&fields=code,product_name,product_name_en,product_name_de,brands,nutriments,serving_quantity`,
    { headers: UA },
  )
  if (!r.ok) throw new Error(`OFF ${r.status}`)
  return (await r.json()).hits ?? []
}

type FdcNutrient = { nutrientNumber?: string; value?: number }
async function searchUsda(q: string) {
  const key = Deno.env.get('FDC_API_KEY') || 'DEMO_KEY'
  const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'], pageSize: 15 }),
  })
  if (!r.ok) throw new Error(`USDA ${r.status}`)
  const j = await r.json()
  // deno-lint-ignore no-explicit-any
  return (j.foods ?? []).flatMap((f: any) => {
    const n = (num: string) => (f.foodNutrients as FdcNutrient[] | undefined)?.find((x) => x.nutrientNumber === num)?.value
    const kcal = n('208') ?? n('958') ?? n('957') ?? (n('268') != null ? n('268')! / 4.184 : undefined)
    if (kcal == null) return []
    return [{
      fdcId: f.fdcId,
      name: String(f.description),
      category: f.foodCategory ?? null,
      kcal_100g: Math.round(kcal * 10) / 10,
      protein_100g: n('203') ?? null,
      carbs_100g: n('205') ?? null,
      fat_100g: n('204') ?? null,
    }]
  })
}

const LOOKUP_SYSTEM = `You give typical nutrition values per 100 g for a named food or dish, for a calorie tracker.
The name may be German (Austrian dishes are common) or English. Use standard food tables; for dishes assume a typical home or restaurant recipe.
Return the English name (plus the original name in brackets if it was not English), values per 100 g, and one typical portion with its weight.
Keep notes to one short sentence (main assumption).`

const LOOKUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g', 'portion_g', 'portion_label', 'notes'],
  properties: {
    name: { type: 'string' },
    kcal_100g: { type: 'number' },
    protein_100g: { type: 'number' },
    carbs_100g: { type: 'number' },
    fat_100g: { type: 'number' },
    portion_g: { type: 'number' },
    portion_label: { type: 'string', description: 'e.g. "1 Semmel", "1 plate"' },
    notes: { type: 'string' },
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: {
    mode?: string
    image?: string
    mediaType?: string
    grams?: number
    note?: string
    recipe?: string
    totalGrams?: number
    q?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Food search across databases (no AI involved):
  //  - Open Food Facts: packaged products (German + English names)
  //  - USDA FoodData Central: generic foods & dishes with lab values (English names).
  //    Optional secret FDC_API_KEY (free at api.data.gov/signup); DEMO_KEY otherwise (low rate limit).
  if (body.mode === 'search') {
    const q = String(body.q ?? '').trim().slice(0, 100)
    if (!q) return json({ hits: [], generic: [] })
    const [off, usda] = await Promise.allSettled([searchOff(q), searchUsda(q)])
    if (off.status === 'rejected' && usda.status === 'rejected') return json({ error: 'Food search unavailable' }, 502)
    return json({
      hits: off.status === 'fulfilled' ? off.value : [],
      generic: usda.status === 'fulfilled' ? usda.value : [],
    })
  }

  // AI lookup: typical nutrition per 100 g for any food or dish name, in any language.
  if (body.mode === 'lookup') {
    const q = String(body.q ?? '').trim().slice(0, 200)
    if (!q) return json({ error: 'Missing food name' }, 400)
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: LOOKUP_SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: LOOKUP_SCHEMA } },
        messages: [{ role: 'user', content: `Food: ${q}` }],
      })
      if (response.stop_reason === 'refusal') return json({ error: 'The model declined this lookup.' }, 422)
      const text = response.content.find((b) => b.type === 'text')
      if (!text || text.type !== 'text') return json({ error: 'No result returned' }, 502)
      return json(JSON.parse(text.text))
    } catch (e) {
      if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}: ${e.message}` }, 502)
      return json({ error: String(e) }, 500)
    }
  }

  const grams = Number(body.grams) > 0 ? Number(body.grams) : null
  const content: Anthropic.Beta.BetaContentBlockParam[] = []

  if (body.mode === 'photo') {
    if (!body.image || body.image.length > 6_000_000) return json({ error: 'Missing or too large image' }, 400)
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mediaType ?? '') ? body.mediaType! : 'image/jpeg'
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: body.image },
    })
    content.push({
      type: 'text',
      text:
        `Estimate the nutrition of the food in this photo.\n` +
        (grams ? `The portion on the plate weighs ${grams} g in total (measured on a scale).\n` : 'No weight was given; estimate the portion size from the photo.\n') +
        (body.note ? `Extra info from the user: ${body.note.slice(0, 500)}\n` : ''),
    })
  } else if (body.mode === 'recipe') {
    if (!body.recipe?.trim()) return json({ error: 'Missing recipe' }, 400)
    const total = Number(body.totalGrams) > 0 ? Number(body.totalGrams) : null
    content.push({
      type: 'text',
      text:
        `Here is a recipe (ingredients with amounts, possibly steps):\n<recipe>\n${body.recipe.slice(0, 6000)}\n</recipe>\n` +
        `First work out the nutrition of the whole recipe from the ingredient amounts.\n` +
        (total ? `The finished dish weighed ${total} g in total after cooking.\n` : 'The weight of the finished dish is unknown; assume typical water loss/gain when cooking.\n') +
        (grams ? `The user ate a ${grams} g portion. Scale the result to that portion.\n` : 'The user ate one serving; if the recipe states servings, use one of them, otherwise the whole recipe.\n') +
        `List the ingredients (scaled to the portion) as items.`,
    })
  } else {
    return json({ error: 'mode must be "photo" or "recipe"' }, 400)
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    })

    if (response.stop_reason === 'refusal') return json({ error: 'The model declined to analyse this.' }, 422)
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return json({ error: 'No result returned' }, 502)
    return json(JSON.parse(text.text))
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Anthropic API key is missing or invalid (check the function secret).' }, 500)
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Rate limited — try again in a minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}: ${e.message}` }, 502)
    return json({ error: String(e) }, 500)
  }
})
