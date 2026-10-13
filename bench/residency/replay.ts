// The residency replay (#1527, M1 and M2 of the residency design), offline, no browser and no GPU:
// `node bench/residency/replay.ts [--tiles trace.json]... [--vsm trace.json]... [--record dir]
// [--out result.json]`. Recorded traces are read (`trace.ts`); without one, the generated flights
// are (`flight.ts`). Each texture trace runs through every policy at pools of 25, 50 and 100 % of
// its peak working set, each shadow trace through both orders, and the rule of the design decides.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { heapPolicy, fineRank, rankPolicy, type TilePolicy } from './tilePolicies.ts'
import { peakWorkingSet, replayTiles, type TileReplay } from './tileReplay.ts'
import { replayVsm, type VsmReplay } from './vsmReplay.ts'
import { tileFlight, vsmFlight, type Flight } from './flight.ts'
import { readTileTrace, readVsmTrace, writeTrace, type TileTrace, type VsmTrace } from './trace.ts'

const SHARES = [0.25, 0.5, 1]

/** The two generated flights: a fly-through with a cut, and an oblique, densely textured walk. */
export const FLIGHTS: Flight[] = [
  {
    name: 'fly-through',
    frames: 480,
    width: 640,
    height: 360,
    fov: Math.PI / 3,
    textures: 24,
    side: 4096,
    patch: 32,
    camera: (f) => ({
      x: f * 2 + (f >= 300 ? 5000 : 0),
      y: 40 * Math.sin(f / 60),
      z: 30,
      yaw: 0.3 * Math.sin(f / 90),
      pitch: -0.35,
    }),
    cuts: [300],
  },
  {
    name: 'oblique-dense',
    frames: 480,
    width: 640,
    height: 360,
    fov: Math.PI / 3,
    textures: 64,
    side: 4096,
    patch: 4,
    camera: (f) => ({ x: f * 0.2, y: 0, z: 1.7, yaw: f * 0.01, pitch: -0.08 }),
    cuts: [],
  },
]

/** The policies compared at a pool of `places`: today's heap, the heap that hears ancestors, the
 *  GPU rank (b), its finer ages (c), and (b) under M3's window of a whole feedback phase. */
const tilePolicies = (places: number): TilePolicy[] => [
  heapPolicy(places, false),
  heapPolicy(places, true),
  rankPolicy(places, { name: 'rank' }),
  rankPolicy(places, { name: 'rank fine', rankOf: fineRank }),
  rankPolicy(places, { name: 'rank window 16', inUse: 16 }),
]

/** Every policy over `trace`, at each share of its peak working set. */
export function compareTiles(trace: TileTrace) {
  const peak = peakWorkingSet(trace)
  return SHARES.flatMap((share) => {
    const places = Math.max(1, Math.ceil(share * peak))
    return tilePolicies(places).map((policy) => replayTiles(trace, policy, { places }))
  })
}

/** Both orders over `trace`, at each share of the pages it wants, never under one frame's. */
export function compareVsm(trace: VsmTrace) {
  const all = new Set(trace.frames.flatMap(({ pages }) => [...pages])).size,
    frame = trace.frames.reduce((peak, { pages }) => Math.max(peak, pages.length), 0)
  return SHARES.flatMap((share) => {
    const pages = Math.max(frame, Math.ceil(share * all))
    return (['lru', 'rank'] as const).map((order) => replayVsm(trace, order, pages))
  })
}

/** The design's rule (M1): the rank kept if, at every pool size, it refetches no more and leaves
 *  no more deficit than today's heap; between (b) and (c), the lower deficit. */
export function tileVerdict(results: readonly TileReplay[]) {
  const at = (name: string) => results.filter((r) => r.policy === name)
  const heap = at('heap')
  const holds = (name: string) =>
    at(name).every(
      (r, i) =>
        r.refetchPerKiloFrame <= heap[i].refetchPerKiloFrame && r.deficit <= heap[i].deficit,
    )
  const kept = ['rank', 'rank fine'].filter(holds)
  if (!kept.length) return 'keep the heap'
  const sum = (name: string) => at(name).reduce((total, r) => total + r.deficit, 0)
  return `take ${kept.sort((a, b) => sum(a) - sum(b))[0]}`
}

/** M2: the rank's buckets kept if they draw no more pages again than the exact order. */
export const vsmVerdict = (results: readonly VsmReplay[]) =>
  results
    .filter((r) => r.order === 'rank')
    .every((r, i) => r.missesPerFrame <= results.filter((l) => l.order === 'lru')[i].missesPerFrame)
    ? 'take the rank'
    : 'keep exact young ages'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      tiles: { type: 'string', multiple: true },
      vsm: { type: 'string', multiple: true },
      record: { type: 'string' },
      out: { type: 'string' },
    },
  })
  const tiles = values.tiles?.map(readTileTrace) ?? FLIGHTS.map(tileFlight)
  const shadows = values.vsm?.map(readVsmTrace) ?? FLIGHTS.map((flight) => vsmFlight(flight))
  if (values.record) {
    mkdirSync(values.record, { recursive: true })
    for (const trace of [...tiles, ...shadows])
      writeTrace(
        join(values.record, `${trace.name}.${'tails' in trace ? 'tiles' : 'vsm'}.json`),
        trace,
      )
  }
  const report = {
    tiles: tiles.map((trace) => {
      const results = compareTiles(trace)
      return { trace: trace.name, results, verdict: tileVerdict(results) }
    }),
    vsm: shadows.map((trace) => {
      const results = compareVsm(trace)
      return { trace: trace.name, results, verdict: vsmVerdict(results) }
    }),
  }
  for (const { trace, results, verdict } of report.tiles) {
    console.log(`\n${trace} (textures): ${verdict}`)
    console.table(results.map(({ converge, ...row }) => ({ ...row, converge: converge.join(' ') })))
  }
  for (const { trace, results, verdict } of report.vsm) {
    console.log(`\n${trace} (shadows): ${verdict}`)
    console.table(results)
  }
  if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2))
}
