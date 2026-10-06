// The shipped projection's page lookups (`projectionDataWgsl.ts`, `pageTableWgsl.ts`) and ray
// march (`traceWgsl.ts`), run in JavaScript (`shaderRun`) over a made-up world: page-table words
// drawn per entry (unmapped, mapped, or falling back 1-3 levels coarser, whose own entry is then
// drawn the same way), projection records per map, pool words per texel — each a hash of its
// address, so a word read twice is the same word. The world counts the page-table words read.
import { Mat } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { vsmProjectionWgsl } from './projectionWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { vsmLayout } from './layout.ts'

const { VSM_ENTRY_MAPPED_BIT: ANY, VSM_ENTRY_DRAWABLE_BIT: RENDER } =
  wgslConstants(VSM_CONSTANTS_WGSL)
const LAYOUT = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27)
export const CODE = vsmProjectionWgsl(LAYOUT, { subgroups: false })

/** A 32-bit hash of integers: the same for the same ones. */
function hash(...words: number[]) {
  let h = 0x9e3779b9
  for (const w of words) h = Math.imul(h ^ (w >>> 0), 0x85ebca6b) ^ (h >>> 13)
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35)
  return (h ^ (h >>> 15)) >>> 0
}
/** A hash in [0, 1). */
export const unit = (...words: number[]) => hash(...words) / 2 ** 32

const WORD = new Float32Array(1),
  BITS = new Uint32Array(WORD.buffer)
/** An f32's bits. */
export const f32Bits = (x: number) => ((WORD[0] = x), BITS[0])

/** Each structure `source` declares, as its constructor: the arguments in member order. */
export function constructors(source: string) {
  const out: Record<string, (...args: unknown[]) => object> = {}
  for (const [, name, body] of source.matchAll(/struct (\w+)\s*\{([^}]*)\}/g)) {
    const keys = [...body.replace(/\/\/[^\n]*/g, '').matchAll(/(\w+)\s*:\s*\w+/g)].map((m) => m[1])
    out[name] = (...args) => Object.fromEntries(keys.map((key, i) => [key, args[i]]))
  }
  return out
}

/** The page-table word of entry `i`: unmapped (1 in 10), mapped (11 in 20), or falling back. */
function entry(seed: number, i: number) {
  const r = unit(seed, i, 1)
  const physical = (hash(seed, i, 2) & 0x7f) | ((hash(seed, i, 3) & 31) << 10)
  if (r < 0.1) return 0
  if (r < 0.65) return (ANY | RENDER | physical) >>> 0
  return (ANY | ((1 + (hash(seed, i, 4) % 3)) << 20) | physical) >>> 0
}

/** A world `seed`: the scope `shaderRun` reads the tables through, and its count of table reads. */
export function vsmWorld(seed: number) {
  const reads = { pageTable: 0 }
  const record = (id: number) => {
    const m: number[] = Array.from({ length: 16 }, (_, k) => (k % 5 === 0 ? 1 : 0))
    m[14] = unit(seed, id, 7)
    return {
      cornerSteps: [(hash(seed, id, 5) % 9) - 4, (hash(seed, id, 6) % 9) - 4],
      lightViewToClip: new Mat(m),
    }
  }
  const scope = {
    ...wgslConstants(CODE),
    ...constructors(CODE),
    vsm: {
      pageTableRowMask: LAYOUT.pageTableRowMask,
      pageTableRowShift: LAYOUT.pageTableRowShift,
      pageTableSize: LAYOUT.pageTableSize,
    },
    vsmProjectionData: new Proxy({}, { get: (_, id) => record(Number(id)) }),
    vsmPageTableLoad: (i: number) => (reads.pageTable++, entry(seed, i)),
    vsmPoolLoad: (t: number[], slice: number) => f32Bits(unit(seed, t[0], t[1], slice, 8)),
    // `bitcast<vec2u>` of a signed vector (`vsmCoarserLevelPage`): its words.
    bitcast_vec2u: (v: number[]) => v.map((x) => x >>> 0),
  }
  return { scope, reads }
}

/** A page-table entry's address and word, by name. */
const TABLE_FUNCTIONS = [
  'vsmTableWord',
  'vsmTableIndex',
  'vsmUnpackTableEntry',
  'vsmTableEntryOf',
  'vsmTableEntryAt',
  'vsmTableLevelOrigin',
  'vsmMipTailOffset',
  'vsmTexelsAtLevel',
  'vsmPoolDepth',
  'vsmEmptyRead',
]
/** The clipmaps' page lookups, by name. */
export const PAGE_FUNCTIONS = [
  'vsmClipmapBasePage',
  'vsmClipmapPage',
  'vsmReadClipmap',
  'vsmReadClipmapPage',
  'vsmClipmapTexel',
  'vsmClipmapTexelDepth',
  'vsmCoarserLevelPage',
  'vsmLevelToLevelOf',
  'vsmHandleOffset',
  'vsmHandleInvalid',
  ...TABLE_FUNCTIONS,
]
/** A pointer to a ray state, as \`shaderRun\` hands one to a \`ptr<function,…>\` parameter. */
export type Ptr<T> = { get: () => T; set: (v: T) => void }
export const ref = <T extends object>(state: T): Ptr<T> => ({
  get: () => state,
  set: (v) => Object.assign(state, v),
})
export const IDENTITY = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
