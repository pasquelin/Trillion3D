// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight share.
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit } from './runtimeOracle.fixture.ts'
import { RAY_TRIANGLES, RAY_WORK } from './runtimeLayout.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtLayers',
  'rtSurfaceOf',
  'rtFacing',
  'rtScene',
  'rtSceneAny',
  'rtEnter',
  'rtEntry',
  'placementRay',
  'rtTraceCut',
  'rtSpent',
  'rtWhy',
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
  'rtProbeRay',
]
/** The proxy's bindings the run declares. */
export const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14 }

/** Helpers the tests call: a ray's work and triangle tests (`rtBegin` clears both), and the first
 *  surface it hit: where, which way it faces, whether it met one. */
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
fn testHit()->vec4f{return vec4f(select(vec3f(0.0),rtHitAt,rtHitFound),select(0.0,1.0,rtHitFound));}
fn testHitNormal()->vec3f{return rtHitNormal;}
`

/** The light buffer's sky of a scene that shows none: every slot zero, no air. */
export const NO_SKY = {
  sky: Array.from({ length: 11 }, () => [0, 0, 0, 0]),
  atmosphere: [[0, 0, 0, 0]],
  skyRays: [],
}

/** The shipped program over `w`, the sky its rays that leave the scene reach the light buffer's
 *  (`directLights`, none by default); its rays' budget the whole one, `RAY_WORK`. */
export function runOver(w: ReturnType<typeof world>, directLights: object = NO_SKY) {
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
    rtProbeRay: (o: Vec3, d: Vec3, reach: number) => number[]
    rtBlocked: (o: Vec3, d: Vec3, span: number) => boolean
    testWork: () => number
    testTests: () => number
    testHit: () => number[]
    testHitNormal: () => number[]
    rtBegin: () => void
  }>(text, [...FUNCTIONS, 'testWork', 'testTests', 'testHit', 'testHitNormal'], {
    directLights,
    rtProxy: header,
    rtWorlds: w.worlds,
    rtTree: w.tree,
    rtWork: 0,
    rtTests: 0,
    rtExtra: 0,
    rtBudget: RAY_WORK,
    rtTestBudget: RAY_TRIANGLES,
    rtCause: 0,
    rtHitAt: [0, 0, 0],
    rtHitNormal: [0, 0, 0],
    rtHitFound: false,
    rtAnyHit: false,
    rtLost: false,
    // The lights are not this program's: a surface lit is its tint, the lighting a unit.
    surfaceLit: (tint: Vec3) => tint,
    surfaceSeen: (tint: Vec3) => tint,
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
