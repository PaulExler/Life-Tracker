/**
 * Offline search over official European food composition tables, bundled with the app:
 *  - BLS 4.0 – Bundeslebensmittelschlüssel, Max Rubner-Institut (2025), CC BY 4.0,
 *    DOI 10.25826/Data20251217-134202-0
 *  - Schweizer Nährwertdatenbank V6.5, Bundesamt für Lebensmittelsicherheit und Veterinärwesen (BLV)
 * File rows: [source, name, altNames, kcal, protein, carbs, fat] per 100 g.
 */
import type { OffProduct } from './food'

type Row = [src: 'BLS' | 'CH', name: string, alt: string, kcal: number, p: number | null, c: number | null, f: number | null]

export const TABLE_LABEL: Record<Row[0], string> = { BLS: 'BLS (DE)', CH: 'Swiss table (CH)' }

let cache: Promise<{ row: Row; hay: string }[]> | null = null

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * Austrian (and a few English) words → the terms used in the German tables.
 * Keys also match inside compound words: "huehnerbrust" → "haehnchenbrust", "topfenstrudel" → "quarkstrudel".
 */
const SYNONYMS: Record<string, string[]> = {
  huehner: ['haehnchen'], huhn: ['haehnchen'], hendl: ['haehnchen'], truthahn: ['pute'],
  erdaepfel: ['kartoffel'], erdapfel: ['kartoffel'], paradeiser: ['tomate'], topfen: ['speisequark', 'quark'],
  schlagobers: ['schlagsahne'], obers: ['sahne'], karfiol: ['blumenkohl'], fisolen: ['gruene bohnen', 'bohnen'],
  marille: ['aprikose'], ribisel: ['johannisbeere'], semmel: ['broetchen', 'weizenbroetchen'], weckerl: ['broetchen'], kipferl: ['hoernchen'],
  kren: ['meerrettich'], faschiertes: ['hackfleisch'], faschiert: ['hackfleisch'], fleischlaberl: ['frikadelle', 'bulette'],
  laberl: ['frikadelle'], germ: ['hefe'], kohlsprossen: ['rosenkohl'], melanzani: ['aubergine'],
  eierschwammerl: ['pfifferling'], schwammerl: ['pilze', 'champignon'], haeuptelsalat: ['kopfsalat'], vogerlsalat: ['feldsalat'],
  powidl: ['pflaumenmus'], kukuruz: ['mais'], zwetschke: ['pflaume'], stelze: ['eisbein', 'haxe'],
  leberkaese: ['fleischkaese'], leberkas: ['fleischkaese'], beiried: ['rind'], lungenbraten: ['rinderfilet'],
  nockerl: ['nocken', 'spaetzle'], knoedel: ['kloss', 'knoedel'], palatschinke: ['pfannkuchen', 'crepe'],
  schmarrn: ['schmarren'], eierspeise: ['ruehrei'], eierspeis: ['ruehrei'], nudeln: ['teigwaren', 'nudeln', 'spaghetti'], nudel: ['teigwaren', 'nudel'], spiegelei: ['spiegelei'], krapfen: ['berliner', 'krapfen'],
  frankfurter: ['wiener wuerstchen', 'wuerstchen'], wuerstel: ['wuerstchen'], sackerl: [], marmelade: ['konfituere', 'marmelade'],
  gebacken: ['paniert', 'frittiert'], rahm: ['sahne'], sauerrahm: ['saure sahne'], jogurt: ['joghurt'],
  'rote ruebe': ['rote bete'], ribisl: ['johannisbeere'], erdbeer: ['erdbeere'], kuerbiskern: ['kuerbiskern'],
  chicken: ['haehnchen'], rice: ['reis'], potato: ['kartoffel'], egg: ['ei'], bread: ['brot'], cheese: ['kaese'], milk: ['milch'],
}
const SYN_KEYS = Object.keys(SYNONYMS).filter((k) => !k.includes(' ')).sort((x, y) => y.length - x.length)

/** A query word plus its synonym spellings (whole word or inside a compound). */
function variants(w: string): string[] {
  const out = new Set([w])
  for (const k of SYN_KEYS) {
    if (!w.includes(k)) continue
    for (const v of SYNONYMS[k]) out.add(w.replace(k, v))
  }
  return [...out].filter((x) => x.length >= 2)
}

async function load() {
  if (!cache)
    cache = fetch(`${import.meta.env.BASE_URL}data/foods-eu.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Row[]) => rows.map((row) => ({ row, hay: norm(`${row[1]} ${row[2]}`) })))
      .catch((e) => {
        cache = null
        throw e
      })
  return cache
}

/** Start downloading the table early (e.g. when the search panel opens). */
export function preloadTables() {
  load().catch(() => {})
}

/** Search the bundled tables. Every query word (or one of its synonyms) must appear. */
export async function searchTables(q: string, limit = 25): Promise<OffProduct[]> {
  const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
  if (words.length === 0) return []
  const rows = await load()
  let hits = rank(rows, words.map(variants), norm(q).trim())
  // Nothing found (e.g. a different spelling like "Kaiserschmarrn" vs. "Kaiserschmarren"): retry with shortened words.
  if (hits.length === 0) hits = rank(rows, words.map((w) => variants(w.length > 6 ? w.slice(0, w.length - 2) : w)), '')
  return hits.slice(0, limit).map(({ row }) => ({
    barcode: '',
    name: row[1],
    brand: TABLE_LABEL[row[0]],
    kcal_100g: row[3],
    protein_100g: row[4],
    carbs_100g: row[5],
    fat_100g: row[6],
    default_grams: null,
    origin: 'table' as const,
    note: row[2] && row[0] === 'BLS' ? row[2] : row[2] ? `Also: ${row[2]}` : undefined,
  }))
}

const isLetter = (ch: string | undefined) => !!ch && /[a-z0-9]/.test(ch)

function rank(rows: { row: Row; hay: string }[], alts: string[][], whole: string) {
  const scored: { row: Row; score: number }[] = []
  for (const { row, hay } of rows) {
    const name = norm(row[1])
    let score = 0
    let okAll = true
    for (const group of alts) {
      let best = -1
      for (const a of group) {
        const i = hay.indexOf(a)
        if (i < 0) continue
        const inName = i < name.length
        const wordStart = i === 0 || !isLetter(hay[i - 1])
        const next = hay[i + a.length]
        const wordEnd = !isLetter(next) && next !== '-'
        // whole word in the name >> start of a compound ("Haferflocken" over "Haferflockenplätzchen") >> inside a word
        let sc = (wordStart ? 10 : 3) + (wordStart && wordEnd ? 8 : 0) + (i === 0 ? 6 : 0) - Math.min(i, 40) / 10
        if (!inName) sc -= 6 // only matched the English name / synonyms
        best = Math.max(best, sc)
      }
      if (best < 0) {
        okAll = false
        break
      }
      score += best
    }
    if (!okAll) continue
    if (whole && (name === whole || name.startsWith(whole + ' ') || name.startsWith(whole + ','))) score += 12
    // plain staples first: shorter names, and "roh"/"gekocht" basics over prepared variants
    score -= name.length / 12
    if (/\b(roh|gekocht|gegart)\b/.test(name)) score += 1.5
    if (row[0] === 'BLS') score += 0.5
    scored.push({ row, score })
  }
  return scored.sort((x, y) => y.score - x.score)
}
