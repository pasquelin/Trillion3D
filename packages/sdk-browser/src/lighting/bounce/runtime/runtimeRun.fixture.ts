// The shipped WGSL of the run-time proxy's rays run as JavaScript (`shaderRun`) over a scene
// (`runtimeScene.fixture.ts`), and the helpers the tests along a line of sight share.
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { runtimeProbeRayWgsl } from './runtimeRadianceWgsl.ts'
import type { world } from './runtimeScene.fixture.ts'
import type { Hit } from './runtimeOracle.fixture.ts'
import { RAY_TRIANGLES, RAY_WORK } from './runtimeLayout.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'

/** The functions of the program the run reaches, each named: the interpreter follows the library's alone. */
const FUNCTIONS = [
  'rtBegin',
  'rtRadiance',
  'rtLayers',
  'rtLayersOver',
  'rtNoRings',
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
  'rtAdvance',
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
/** The tracer's private state at the start of a walk (`rtBegin`): every `var<private>` of the proxy's rays, the
 *  counters zero, the budgets the whole ones, which a program run over it (`runOver`, a stage of the reflections) is
 *  given. */
export const RT_PRIVATE_STATE = {
  rtWork: 0,
  rtTests: 0,
  rtShadowWork: 0,
  rtBudget: RAY_WORK,
  rtTestBudget: RAY_TRIANGLES,
  rtCause: 0,
  rtReached: 0,
  rtReachedPlacement: 0,
  rtAnyHit: false,
  rtShadowFree: 0,
  rtShadowHit: 0,
  rtShadowCause: 0,
  rtMembers: 0,
}

/** The windows of a ringed walk (`RtRings`) and what a walk answers (`RtWalk`), as the run reads and returns them. */
export type RtRings = {
  begins: number[]
  ends: number[]
  count: number
  work: number
  tests: number
  on: boolean
  detail: number[]
  detailWork: number
  detailTests: number
}
export type RtWalk = {
  answer: { color: Vec3; confidence: number; distance: number }
  stopped: number
  open: number
  spent: number
  work: number
}

/** The proxy's bindings the run declares. */
export const BINDINGS = { group: 0, proxy: 12, worlds: 13, tree: 14 }

/** Helpers the tests call: a ray's work, with its shadow rays' and its own, and triangle tests, what exhausted its
 *  walk and how far the walk had reached, what its shadow rays found and what exhausted the first that did, and
 *  the units the tree's groups took of its work (`rtBegin` clears them). */
const HELPERS = `fn testWork()->u32{return rtWork+rtShadowWork;}
fn testOwnWork()->u32{return rtWork;}
fn testTests()->u32{return rtTests;}
fn testCause()->u32{return rtCause;}
fn testReached()->f32{return rtReached;}
fn testShadowFree()->u32{return rtShadowFree;}
fn testShadowHit()->u32{return rtShadowHit;}
fn testShadowCause()->u32{return rtShadowCause;}
fn testMembers()->u32{return rtMembers;}
`
/** The helpers' names, read from their text. */
const TESTS = [...HELPERS.matchAll(/fn (test\w+)/g)].map((m) => m[1])

/** The light buffer's air of a scene that shows none: no air. */
export const NO_SKY = {
  atmosphere: [[0, 0, 0, 0]],
  skyRays: [],
}

/** The shipped program over `w`, the air its rays that leave the scene reach the light buffer's
 *  (`directLights`, none by default), the sky light's cube a test's own (`skyLight`); its rays' budget the whole one, `RAY_WORK`. `overrides` replace
 *  what the program binds or defines by name: a probe's budget (`RT_PROBE_WORK`), the lighting of a hit. */
export function runOver(
  w: ReturnType<typeof world>,
  directLights: object = NO_SKY,
  overrides: object = {},
) {
  const { header } = w
  const text = wgslModule(runtimeProbeRayWgsl(BINDINGS)) + HELPERS
  const run = shaderRun<{
    rtScene: (o: Vec3, d: Vec3, limit: number) => Hit
    rtRadiance: (
      o: Vec3,
      d: Vec3,
      reach: number,
      tangent: number,
      budget: number,
    ) => { color: Vec3; confidence: number; distance: number }
    rtLayersOver: (
      o: Vec3,
      d: Vec3,
      reach: number,
      tangent: number,
      budget: number,
      tests: number,
      lit: boolean,
      rings: RtRings,
    ) => RtWalk
    rtNoRings: () => RtRings
    rtProbeRay: (o: Vec3, d: Vec3, reach: number) => number[]
    rtBlocked: (o: Vec3, d: Vec3, span: number) => boolean
    testWork: () => number
    testOwnWork: () => number
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
    // No sky light shines unless a test says (`skyLight`).
    skyLightApplied: () => false,
    skyLightRay: () => [0, 0, 0],
    rtProxy: header,
    rtWorlds: w.worlds,
    rtTree: w.tree,
    ...RT_PRIVATE_STATE,
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
