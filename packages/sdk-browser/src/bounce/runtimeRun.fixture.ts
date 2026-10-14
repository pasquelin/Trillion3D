// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight share.
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import { SHARED_EXPONENT_WGSL } from './sharedExponentWgsl.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit, Vec } from './runtimeOracle.fixture.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtPackShared',
  'rtUnpackShared',
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
const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14 }

/** Helpers the tests call: a ray's work and triangle tests, and both cleared. */
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
fn testReset(){rtWork=0u;rtTests=0u;}
`

/** The shipped program over `w`. */
export function runOver(w: ReturnType<typeof world>) {
  const { header } = w
  const text = wgslModule(runtimeRadianceWgsl(BINDINGS), SHARED_EXPONENT_WGSL) + HELPERS
  return shaderRun<{
    rtScene: (o: Vec, d: Vec, limit: number) => Hit
    rtRadiance: (
      o: Vec,
      d: Vec,
      reach: number,
      tangent: number,
    ) => { color: Vec; confidence: number }
    rtPackShared: (c: Vec) => number
    rtUnpackShared: (word: number) => Vec
    testWork: () => number
    testTests: () => number
    testReset: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testReset'], {
    rtProxy: header,
    rtWorlds: w.worlds,
    rtTree: w.tree,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtAnyHit: false,
    rtLost: false,
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
    PlacedRay: (origin: Vec, direction: Vec, regular: boolean) => ({
      origin,
      direction,
      regular,
    }),
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
