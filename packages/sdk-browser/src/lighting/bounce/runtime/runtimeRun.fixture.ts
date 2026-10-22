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
  'rtStoppedSeen',
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

/** Helpers the tests call: a ray's work and triangle tests, what exhausted its walk and how far the walk had
 *  reached, what its shadow rays found and what exhausted the first that did, and the units the tree's groups
 *  took of its work (`rtBegin` clears them). */
const TESTS = [
  'testWork',
  'testTests',
  'testCause',
  'testReached',
  'testShadowFree',
  'testShadowHit',
  'testShadowCause',
  'testMembers',
]
const HELPERS = `fn testWork()->u32{return rtWork+rtExtra;}
fn testTests()->u32{return rtTests;}
fn testCause()->u32{return rtCause;}
fn testReached()->f32{return rtReached;}
fn testShadowFree()->u32{return rtShadowFree;}
fn testShadowHit()->u32{return rtShadowHit;}
fn testShadowCause()->u32{return rtShadowCause;}
fn testMembers()->u32{return rtMembers;}
`

/** The light buffer's sky of a scene that shows none: every slot zero, no air. */
export const NO_SKY = {
  sky: Array.from({ length: 11 }, () => [0, 0, 0, 0]),
  atmosphere: [[0, 0, 0, 0]],
  skyRays: [],
}

/** The shipped program over `w`, the sky its rays that leave the scene reach the light buffer's
 *  (`directLights`, none by default); its rays' budget the whole one, `RAY_WORK`. `overrides` replace
 *  what the program binds or defines by name: a probe's budget (`RT_PROBE_WORK`), the lighting of a hit. */
export function runOver(
  w: ReturnType<typeof world>,
  directLights: object = NO_SKY,
  overrides: object = {},
) {
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
    testCause: () => number
    testReached: () => number
    testShadowFree: () => number
    testShadowHit: () => number
    testShadowCause: () => number
    testMembers: () => number
    rtBegin: () => void
  }>(text, [...FUNCTIONS, ...TESTS], {
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
    rtReached: 0,
    rtAnyHit: false,
    rtShadowFree: 0,
    rtShadowHit: 0,
    rtShadowCause: 0,
    rtMembers: 0,
    // The lights are not this program's: a surface lit is its tint, the lighting a unit.
    surfaceLit: (tint: Vec3) => tint,
    surfaceSeen: (tint: Vec3) => tint,
    ...overrides,
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
