// One column of the light grid's pass, two ways: the shipped routines of `compactWgsl.ts` run lane
// by lane in the order `lightTiles` (`./shader.ts`) runs them between its barriers, and a serial
// model — each slice's list the lights whose run holds it, in increasing order. Between two
// barriers the lanes meet only through atomic ORs, the pool's allocators and their own words, so
// running them one after the other is one of the orders the GPU may take.
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { directLightWgsl } from '../direct/lightWgsl.ts'
import { gridCompactWgsl } from './compactWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'

/** The view grid's injection and compaction: a column's depth slices. */
const GRID_COMPACT_WGSL = gridCompactWgsl(LIGHT_SETTINGS.gridSlices)

const W = { ...wgslConstants(directLightWgsl()), ...wgslConstants(GRID_COMPACT_WGSL) }
export const { GRID_SLICES, TILE_SHADOWED } = W
const { EMPTY_RUN, TILE_STRIDE, LINK_NONE } = W
/** A light's run in the column, `[first, last]`, and whether it holds a shadow slot; `null` when
 *  it meets no cell of the column. */
export type Run = { first: number; last: number; slot: boolean } | null
/** The view's pool as the pass binds it: where the lists start, the entries it holds, the entries
 *  asked and the entries the lists hold. */
export type Pool = { start: number; capacity: number; links: number; head: number }
/** A column's cell records, and the pool words it wrote. */
export type Column = {
  counts: number[]
  starts: number[]
  words: Map<number, number>
  /** The slice marks the pass set. */
  marks?: number
}

/** A pool `capacity` words from word `start`, nothing asked yet. */
export const openPool = (capacity: number, start = 1000): Pool => ({
  start,
  capacity,
  links: 0,
  head: 0,
})

/** `count` lights holding every slice, as suns do, every third one with a shadow slot. */
export const suns = (count: number): Run[] =>
  Array.from({ length: count }, (_, i) => ({ first: 0, last: GRID_SLICES - 1, slot: i % 3 === 0 }))

/** What `entryOf` answers for light `index` of run `run`. */
const entryOf = (index: number, run: Run) =>
  run
    ? [(index | (run.slot ? TILE_SHADOWED : 0)) >>> 0, run.first | (run.last << 16)]
    : [index, EMPTY_RUN]

/** WGSL's `u32` arithmetic: sums, differences and products wrap, a division truncates. */
const u32 = (op: string, a: unknown, b: unknown) => {
  if (typeof a !== 'number' || typeof b !== 'number') return builtins.$b(op, a as never, b as never)
  if (op === '/') return Math.trunc(a / b)
  if (op === '*') return Math.imul(a, b) >>> 0
  if (op === '+' || op === '-') return (op === '+' ? a + b : a - b) >>> 0
  return builtins.$b(op, a, b)
}
/** The workgroup's scalars the routines write. */
const SCALARS = /\b(linkBase|listBase)\b/g
const NAMES = [
  'markEntry',
  'linksBefore',
  'reserveLinks',
  'pushLinks',
  'pushOwn',
  'listsBefore',
  'reserveLists',
  'emitSlices',
  'laneRun',
  'ceilDiv',
]
/** Where the records are written: far past any list, so the two read apart. */
const RECORDS_AT = 1 << 28

/** The shipped routines over one workgroup's memory and the pool, its batch `lanes` wide. */
function workgroup(
  pool: Pool,
  words: Map<number, number>,
  records: Map<number, number>,
  lanes: number,
) {
  const laneWords = bitWords(lanes)
  const counter = { marks: 0 }
  // A slice's mask set to anything but zero: one lane's bit marked there.
  const marked = (masks: number[], at: string | symbol, value: number) => (
    value && counter.marks++,
    (masks[at as never] = value as never),
    true
  )
  const memory = {
    chunk: Array.from({ length: lanes }, () => [0, EMPTY_RUN]),
    masks: new Proxy(new Array<number>(laneWords * GRID_SLICES).fill(0), { set: marked }),
    full: new Array<number>(laneWords).fill(0),
    counts: new Array<number>(GRID_SLICES).fill(0),
    heads: new Array<number>(GRID_SLICES).fill(LINK_NONE),
  }
  const tiles = new Proxy([], {
    set: (_, at, value) => (
      (Number(at) >= RECORDS_AT ? records : words).set(Number(at), value),
      true
    ),
  })
  const laneSums: number[] = []
  // The workgroup's two scalars, read through one object the harness sees too.
  const ws = { linkBase: 0, listBase: 0 }
  const fns = shaderRun<Record<string, (...args: never[]) => never>>(
    wgslSource(GRID_COMPACT_WGSL).replace(SCALARS, 'ws.$1'),
    NAMES,
    {
      ...W,
      WORKGROUP_THREADS: lanes,
      LANE_WORDS: laneWords,
      ...memory,
      pool,
      tiles,
      culledLightLinks: [] as number[],
      ws,
      laneSums,
      // The engine's lane scan (`../../gpu/core/laneScanWgsl.ts`), lanes called in order: each
      // lane's inclusive prefix, `laneSums[WORKGROUP_THREADS - 1]` the total.
      laneScan: (lane: number, value: number) =>
        (laneSums[lane] = ((laneSums[lane - 1] ?? 0) + value) >>> 0),
      $b: u32,
    },
  )
  return { counter, fns, ws }
}

/** The column of lights `runs` as the pass runs it in `pool`, in batches of `lanes` — the engine's
 *  `WORKGROUP_THREADS`, or a width occupancy may tune it to —: with `perCell` at 0 the lists are
 *  chains of links; otherwise each cell has `perCell` words of its own, the column's first cell
 *  being `columnCell` of the grid. */
export function shippedColumn(
  runs: Run[],
  pool: Pool,
  { lanes = WORKGROUP_THREADS, perCell = 0, columnCell = 0 } = {},
): Column {
  const words = new Map<number, number>(),
    records = new Map<number, number>()
  const { counter, fns, ws } = workgroup(pool, words, records, lanes)
  const all = Array.from({ length: lanes }, (_, lane) => lane)
  const spans = all.map((lane) => fns.laneRun(lane as never, GRID_SLICES as never))
  /** The scan of the lanes' counts, then lane zero's reservation, then `then` on every lane with
   *  the place its run starts at. */
  const scanned = (
    before: string,
    reserve: string,
    base: () => number,
    then: (lane: number, at: number) => void,
  ) => {
    const sums = all.map((lane) => fns[before](lane as never, spans[lane] as never) as number)
    fns[reserve]()
    all.forEach((lane) => then(lane, (base() + sums[lane]) >>> 0))
  }
  const count = runs.length
  for (let first = 0; first < count; first += lanes) {
    all.forEach((lane) => {
      const light = first + lane
      const entry = light < count ? entryOf(light, runs[light]) : [light, EMPTY_RUN]
      fns.markEntry(lane as never, entry as never)
    })
    scanned(
      'linksBefore',
      'reserveLinks',
      () => ws.linkBase,
      (lane, at) =>
        perCell
          ? fns.pushOwn(spans[lane] as never, columnCell as never, perCell as never)
          : fns.pushLinks(spans[lane] as never, at as never),
    )
  }
  scanned(
    'listsBefore',
    'reserveLists',
    () => pool.start + ws.listBase,
    (lane, at) =>
      fns.emitSlices(
        spans[lane] as never,
        columnCell as never,
        RECORDS_AT as never,
        perCell as never,
        at as never,
      ),
  )
  const record = (slice: number, word: number) =>
    records.get(RECORDS_AT + (columnCell + slice) * TILE_STRIDE + word)!
  const slices = Array.from({ length: GRID_SLICES }, (_, slice) => slice)
  return {
    counts: slices.map((slice) => record(slice, 0)),
    starts: slices.map((slice) => record(slice, 1)),
    words,
    marks: counter.marks,
  }
}

/** The lights of each slice of `column`, as its records and the pool words give them. */
export const listsOf = ({ counts, starts, words }: Column) =>
  counts.map((count, slice) =>
    Array.from({ length: (count & ~TILE_SHADOWED) >>> 0 }, (_, k) => words.get(starts[slice] + k)),
  )

/** The lights of each slice of a column of `runs` before any pool drops one: those whose run holds
 *  the slice, in increasing order. */
export const fullLists = (runs: Run[]) =>
  Array.from({ length: GRID_SLICES }, (_, slice) =>
    runs.flatMap((run, i) => (run && run.first <= slice && slice <= run.last ? [i] : [])),
  )

/** A slice's count word for `kept` lights, the high bit when one of them holds a shadow slot. */
export const countWord = (kept: number[], runs: Run[]) =>
  (kept.length | (kept.some((i) => runs[i]!.slot) ? TILE_SHADOWED : 0)) >>> 0

/** The column the lists of `fullLists` make with the pool wide open, its allocators moved by what
 *  was asked: the links, and the list words (`pool.head`). */
export function serialColumn(runs: Run[], pool: Pool): Column {
  const lists = fullLists(runs),
    words = new Map<number, number>()
  const total = lists.reduce((sum, list) => sum + list.length, 0)
  let at = pool.start + pool.head
  const starts = lists.map((list) => {
    const start = list.length ? at : pool.start
    list.forEach((light, k) => words.set(start + k, light))
    at += list.length
    return start
  })
  pool.links = (pool.links + total) >>> 0
  pool.head = (pool.head + total) >>> 0
  return { counts: lists.map((list) => countWord(list, runs)), starts, words }
}

/** The column with `perCell` words to each cell, the first of them cell `columnCell` of the
 *  grid: each keeps its first lights up to its share and to what the pool holds; the entries asked
 *  and kept are counted. */
export function serialFixedColumn(
  runs: Run[],
  pool: Pool,
  perCell: number,
  columnCell = 0,
): Column {
  const words = new Map<number, number>()
  const lists = fullLists(runs).map((list, slice) => {
    const room = Math.max(0, pool.capacity - (columnCell + slice) * perCell)
    const kept = list.slice(0, Math.min(perCell, room))
    pool.links += list.length
    pool.head += kept.length
    return kept
  })
  const starts = lists.map((list, slice) => {
    const start = pool.start + (columnCell + slice) * perCell
    list.forEach((light, k) => words.set(start + k, light))
    return start
  })
  return { counts: lists.map((list) => countWord(list, runs)), starts, words }
}
