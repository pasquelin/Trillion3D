// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight and over a history share.
import * as G from '../host/graph/graph.fixture.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { HISTORY, HISTORY_HEADER_WORDS, HISTORY_PIXEL_WORDS } from '../reflections/proxyHistory.ts'
import { runtimeTraceWgsl } from './runtimeTraceWgsl.ts'
import type { Hit, Vec, world } from './runtimeScene.fixture.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtRadiance',
  'rtAnswer',
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
  'rtTreeLow',
  'rtTreeHigh',
]
const BINDINGS = { group: 0, proxy: 12, nodes: 13, cold: 14, worlds: 15, history: 16 }

export function runOver(w: ReturnType<typeof world>, history: number[] = [0, 0, 0, 0]) {
  const { packed, header } = w
  const nodes = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length)
  const cold = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    packed.pageCones.length,
  )
  const text =
    wgslModule(runtimeTraceWgsl(BINDINGS)) +
    'fn testWork()->u32{return rtWork;}\nfn testTests()->u32{return rtTests;}\nfn testReset(){rtWork=0u;rtTests=0u;}\nfn testPixel(p:u32){rtPixel=p;rtCalls=0u;}\n'
  return shaderRun<{
    rtScene: (o: Vec, d: Vec, limit: number) => Hit
    rtRadiance: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtAnswer: (o: Vec, d: Vec, reach: number, tangent: number) => { color: Vec; confidence: number }
    testPixel: (pixel: number) => void
    testWork: () => number
    testTests: () => number
    testReset: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testReset', 'testPixel'], {
    rtProxy: header,
    rtNodes: nodes,
    rtCold: cold,
    rtWorlds: packed.worlds,
    rtWork: 0,
    rtTests: 0,
    rtPixel: 0,
    rtCalls: 0,
    rtHistory: history,
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
    ProxyChild: (
      box: unknown,
      offset: number,
      count: number,
      present: boolean,
      owned: boolean,
    ) => ({
      box,
      offset,
      count,
      present,
      owned,
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

/** A history of `pixels` pixels at epoch `epoch`, `spent` of the frame's work gone. */
export const history = (pixels: number, epoch: number, spent: number) => {
  const words = new Array<number>(HISTORY_HEADER_WORDS + pixels * HISTORY_PIXEL_WORDS).fill(0)
  words[HISTORY.epoch] = epoch
  words[HISTORY.spent] = spent
  return words
}
