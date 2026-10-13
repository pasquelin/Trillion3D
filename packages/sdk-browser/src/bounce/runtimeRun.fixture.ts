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
  'rtCounted',
  'rtSurfaceOf',
  'rtSurfaceVec',
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
  'rtOrigin',
  'rtInstanceWord',
  'rtTreeWord',
  'rtTreeLow',
  'rtTreeHigh',
  'rtBlocked',
  'rtLit',
  'rtProbeRay',
  'rtShare',
]
const BINDINGS = { group: 0, proxy: 12, list: 8 }

export function runOver(w: ReturnType<typeof world>, list: number[] = counters(0)) {
  const { header } = w
  const text =
    wgslModule(runtimeTraceWgsl(BINDINGS)) +
    'fn testWork()->u32{return rtWork+rtExtra;}\nfn testTests()->u32{return rtTests;}\nfn testReset(){rtWork=0u;rtTests=0u;}\nfn testShare(){rtShare(0u);atomicStore(&rtGroupSpent[0],0u);rtSpentHere=0u;}\n'
  return shaderRun<{
    rtScene: (o: Vec, d: Vec, limit: number) => Hit
    rtRadiance: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtCounted: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    testWork: () => number
    testTests: () => number
    testReset: () => void
    testShare: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testReset', 'testShare'], {
    rtProxy: header,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtAnyHit: false,
    rtLost: false,
    rtSpentHere: 0,
    rtGroupSpent: [0],
    rtList: list,
    workgroupBarrier: () => {},
    // The lights are not this program's: a surface lit is its tint, the lighting a unit.
    surfaceLit: (tint: Vec) => tint,
    RtSurface: (tint: Vec, opacity: number, emission: Vec, blended: boolean) => ({
      tint,
      opacity,
      emission,
      blended,
    }),
    RtRadiance: (color: Vec, confidence: number) => ({ color, confidence }),
    Box: (low: Vec, high: Vec) => ({ low, high }),
    ProxyChild: (box: unknown, offset: number, count: number, present: boolean) => ({
      box,
      offset,
      count,
      present,
    }),
    InvT3: (adj: unknown, scale: number, regular: boolean) => ({ adj, scale, regular }),
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
