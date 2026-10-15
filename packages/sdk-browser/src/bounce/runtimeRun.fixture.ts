// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight share.
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit } from './runtimeOracle.fixture.ts'
import { RAY_WORK } from './runtimeLayout.ts'
import type { Vec3 } from '../../../math/src/vector/vectorTuple.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtSurfaceOf',
  'rtShade',
  'rtScene',
  'rtEnter',
  'rtEntry',
  'placementRay',
  'rtTraceCut',
  'rtSpent',
  'rtFloat',
  'rtVec',
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
/** The proxy's bindings the run declares. */
export const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14 }

/** Helpers the tests call: a ray's work and triangle tests (`rtBegin` clears both). */
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
`

/** The shipped program over `w`; its rays' budget the whole one, `RAY_WORK`, unless one is given. */
export function runOver(w: ReturnType<typeof world>) {
  const { header } = w
  const text = wgslModule(runtimeRadianceWgsl(BINDINGS)) + HELPERS
  const run = shaderRun<{
    rtScene: (o: Vec3, d: Vec3, limit: number) => Hit
    rtRadiance: (
      o: Vec3,
      d: Vec3,
      reach: number,
      tangent: number,
      budget: number,
    ) => { color: Vec3; confidence: number; distance: number }
    testWork: () => number
    testTests: () => number
    rtBegin: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests'], {
    rtProxy: header,
    rtWorlds: w.worlds,
    rtTree: w.tree,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtBudget: RAY_WORK,
    rtAnyHit: false,
    rtLost: false,
    // The lights are not this program's: a surface lit is its tint, the lighting a unit.
    surfaceLit: (tint: Vec3) => tint,
  })
  return {
    ...run,
    rtRadiance: (o: Vec3, d: Vec3, reach: number, tangent: number, budget = RAY_WORK) =>
      run.rtRadiance(o, d, reach, tangent, budget),
  }
}

/** Cubes along a line of sight from the origin, `gap` apart, the first at `gap`. */
export const along = (count: number, gap: number) =>
  Array.from({ length: count }, (_, k) => new Matrix4().makeTranslation(k * gap + gap, 0, 0))
export const ahead: Vec3 = [1, 0, 0]
export const origin: Vec3 = [0, 0, 0]
