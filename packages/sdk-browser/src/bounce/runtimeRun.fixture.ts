// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight and over a history share.
import * as G from '../host/graph/graph.fixture.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from './runtimeLayout.ts'
import { runtimeTraceWgsl } from './runtimeTraceWgsl.ts'
import type { Hit, Vec, world } from './runtimeScene.fixture.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtRadiance',
  'rtAnswer',
  'rtCellRead',
  'rtCellWrite',
  'rtCellAnswer',
  'rtPackShared',
  'rtUnpackShared',
  'rtStamp',
  'rtSurfaceOf',
  'rtShade',
  'rtScene',
  'rtEnter',
  'rtTraceCut',
  'rtSpent',
  'rtFloat',
  'rtVertex',
  'rtBox',
  'rtChild',
  'rtWorldOf',
  'rtInverseOf',
  'rtInverseApply',
  'rtInstanceWord',
  'rtTreeWord',
  'rtTreeLow',
  'rtTreeHigh',
  'rtBlocked',
  'rtLit',
  'rtProbeRay',
]
const BINDINGS = { group: 0, proxy: 12, list: 8, store: 9 }

/** The store of the answers as the shader reads it: two layers of words a pixel, keyed by texel. */
export function makeStore() {
  const words = new Map<string, number>()
  const key = (at: number[], layer: number) => `${at[0]},${at[1]},${layer}`
  return {
    words,
    get: (at: number[], layer: number) => words.get(key(at, layer)) ?? 0,
    set: (at: number[], layer: number, word: number) => void words.set(key(at, layer), word >>> 0),
  }
}
export type Store = ReturnType<typeof makeStore>

export function runOver(
  w: ReturnType<typeof world>,
  list: number[] = counters(0),
  epoch = 2,
  store: Store = makeStore(),
) {
  const { packed, header } = w
  const text =
    wgslModule(runtimeTraceWgsl(BINDINGS)) +
    'fn testWork()->u32{return rtWork+rtExtra;}\nfn testTests()->u32{return rtTests;}\nfn testReset(){rtWork=0u;rtTests=0u;}\nfn testPixel(x:u32,y:u32,n:u32){rtPixel=vec2u(x,y);rtCalls=0u;rtRank=n;}\n'
  return shaderRun<{
    rtScene: (o: Vec, d: Vec, limit: number) => Hit
    rtRadiance: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtAnswer: (o: Vec, d: Vec, reach: number, tangent: number) => { color: Vec; confidence: number }
    rtPackShared: (c: Vec) => number
    rtUnpackShared: (word: number) => Vec
    testPixel: (x: number, y: number, rank: number) => void
    testWork: () => number
    testTests: () => number
    testReset: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testReset', 'testPixel'], {
    rtProxy: header,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtAnyHit: false,
    rtPixel: [0, 0],
    rtCalls: 0,
    rtRank: 0,
    rtList: list,
    rtStore: store,
    textureLoad: (t: Store, at: number[], layer: number) => [t.get(at, layer), 0, 0, 0],
    textureStore: (t: Store, at: number[], layer: number, v: number[]) => t.set(at, layer, v[0]),
    reflectionView: { runtime: [epoch, 0, 0, 0] },
    // The lights are not this program's: a surface lit is its tint, the lighting a unit.
    surfaceLit: (tint: Vec) => tint,
    RtSurface: (tint: Vec, opacity: number, emission: Vec, blended: boolean) => ({
      tint,
      opacity,
      emission,
      blended,
    }),
    RtRadiance: (color: Vec, confidence: number) => ({ color, confidence }),
    RtCell: (premult: Vec, confidence: number, stamp: number) => ({ premult, confidence, stamp }),
    Box: (low: Vec, high: Vec) => ({ low, high }),
    ProxyChild: (box: unknown, offset: number, count: number, present: boolean) => ({
      box,
      offset,
      count,
      present,
    }),
    RtWorld: (a: Vec, b: Vec, c: Vec, t: Vec) => ({ a, b, c, t }),
    RtInverse: (r0: Vec, r1: Vec, r2: Vec) => ({ r0, r1, r2 }),
    RtHit: (distance: number, placement: number, triangle: number, found: boolean) => ({
      distance,
      placement,
      triangle,
      found,
    }),
  })
}

/** Cubes along a line of sight from the origin, `gap` apart, the first at `gap`. */
export const along = (count: number, gap: number) =>
  Array.from({ length: count }, (_, k) => {
    const m = new G.Matrix4()
    m.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k * gap + gap, 0, 0, 1])
    return m
  })
export const ahead: Vec = [1, 0, 0]
export const origin: Vec = [0, 0, 0]

/** The trace's list of a frame that has spent `spent` of its work: the counters, no tile. */
export const counters = (spent: number) => {
  const words = new Array<number>(TRACE_LIST_FIRST).fill(0)
  words[TRACE_LIST.spent] = spent
  return words
}
