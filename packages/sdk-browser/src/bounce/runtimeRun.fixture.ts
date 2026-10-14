// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight and over a history share.
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeAnswerWgsl } from './runtimeAnswerWgsl.ts'
import { TRACE_LIST, TRACE_LIST_FIRST } from './runtimeLayout.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit, Vec } from './runtimeOracle.fixture.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtAnswer',
  'rtCellRead',
  'rtCellWrite',
  'rtCellAnswer',
  'rtPackShared',
  'rtUnpackShared',
  'rtStamp',
  'rtGroupAdd',
  'rtGroupSend',
  'rtSurfaceOf',
  'rtSurfaceVec',
  'rtShade',
  'rtScene',
  'rtEnter',
  'placementRay',
  'rtTraceCut',
  'rtSpent',
  'rtFloat',
  'rtVertex',
  'rtBox',
  'rtChild',
  'rtWorldOf',
  'rtWorldsLinear',
  'rtWorldsTranslation',
  'rtWorldsColumn',
  'rtWorldsMatrix',
  'rtWorldsOrigin',
  'rtWorldsInstance',
  'rtTreeNode',
  'rtTreeMembers',
  'rtTreeWord',
  'rtTreeMember',
  'rtTreeLow',
  'rtTreeHigh',
  'rtBlocked',
  'rtLit',
  'rtProbeRay',
]
const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14, list: 8, store: 9 }

/** The store of the answers as the shader reads it: two layers of words a pixel, keyed by texel. It
 *  answers its own loads and stores, as every texture the interpreter binds (`shaderRunBuiltins`). */
export function makeStore() {
  const words = new Map<string, number>()
  const key = (at: number[], layer: number) => `${at[0]},${at[1]},${layer}`
  const get = (at: number[], layer: number) => words.get(key(at, layer)) ?? 0
  return {
    words,
    get,
    load: (at: number[], layer: number) => [get(at, layer), 0, 0, 0],
    store: (at: number[], layer: number, value: number[]) =>
      void words.set(key(at, layer), value[0] >>> 0),
  }
}
export type Store = ReturnType<typeof makeStore>

/** Helpers the tests call: a ray's work, a pixel set, and a workgroup's counters shared then cleared. */
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
fn testReset(){rtWork=0u;rtTests=0u;}
fn testPixel(x:u32,y:u32,n:u32){rtPixel=vec2u(x,y);rtCalls=0u;rtRank=n;}
fn testShare(){rtGroupAdd();rtGroupSend();for(var k=0u;k<3u;k++){atomicStore(&rtGroup[k],0u);}rtSpentHere=0u;rtCastHere=false;rtLeftHere=false;}
`

/** The shipped program over `w`: the trace's list `list`, the frame's epoch, the store. */
export function runOver(
  w: ReturnType<typeof world>,
  list: number[] = counters(0),
  epoch = 2,
  store: Store = makeStore(),
) {
  const { header } = w
  const text = wgslModule(runtimeAnswerWgsl(BINDINGS)) + HELPERS
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
    testWork: () => number
    testTests: () => number
    testReset: () => void
    testPixel: (x: number, y: number, rank: number) => void
    testShare: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testReset', 'testPixel', 'testShare'], {
    rtProxy: header,
    rtWorlds: w.worlds,
    rtTree: w.tree,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtAnyHit: false,
    rtLost: false,
    rtPixel: [0, 0],
    rtCalls: 0,
    rtRank: 0,
    rtSpentHere: 0,
    rtCastHere: false,
    rtLeftHere: false,
    rtGroup: [0, 0, 0],
    traceList: list,
    rtStore: store,
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
    InvT3: (adj: unknown, scale: number, regular: boolean) => ({ adj, scale, regular }),
    PlacedRay: (origin: Vec, direction: Vec, regular: boolean) => ({ origin, direction, regular }),
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
    const m = new Matrix4()
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
