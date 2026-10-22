// The reflection's scene stage (`reflectionProxied`, `proxy.ts`) run in JavaScript over the proxy of cubes
// (`runtimeScene.fixture.ts`), whose placement tree is fitted as the engine fits it (`fittedWorld`).
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { NODE_CHILD_COUNT, NODE_FIRST_CHILD, NODE_KIND } from '../../geometry/dag/nodeLayout.ts'
import { TREE_GROUP } from '../../geometry/dag/placement/placementTree.ts'
import { SURFACE_BLENDED } from '../bounce/runtime/runtimeLayout.ts'
import { RT_PRIVATE_STATE } from '../bounce/runtime/runtimeRun.fixture.ts'
import { world } from '../bounce/runtime/runtimeScene.fixture.ts'
import { REFLECTION_FATES } from './censusWgsl.ts'
import { REFLECTION_COUNTS } from './constants.ts'
import { REFLECTION_PROXY_WGSL } from './proxy.ts'
import {
  packEnvironment,
  SCENE_ENVIRONMENT_FLOATS,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { FOG_SLOTS } from '../../../../sdk-core/src/scene/core/fog.ts'
import { ATMOSPHERE_SLOTS } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AIR_BUFFER_STRUCT } from '../atmosphere/layout.ts'
import { FOG_VIEW_SLOTS } from '../fog/viewSlots.ts'

/** The light buffer's blocks a program reads the fog from (`directLights`): the fog `fog` as the scene packs it (none
 *  where it is undefined), no atmosphere, no volume. */
export function fogLights(fog: object | undefined) {
  const zero = (count: number) => Array.from({ length: count }, () => [0, 0, 0, 0])
  const packed = packEnvironment(
    { exposure: 1, fog } as never,
    new Float32Array(SCENE_ENVIRONMENT_FLOATS),
  )
  const at = SCENE_ENVIRONMENT_FLOATS - FOG_SLOTS * 4
  const view = Number(/atmosphereView:array<vec4f,(\d+)>/.exec(AIR_BUFFER_STRUCT)![1])
  return {
    fog: Array.from({ length: FOG_SLOTS }, (_, k) =>
      Array.from(packed.subarray(at + 4 * k, at + 4 * k + 4)),
    ),
    atmosphere: zero(ATMOSPHERE_SLOTS),
    atmosphereView: zero(view),
    fogView: zero(FOG_VIEW_SLOTS),
  }
}

/** `world(count, seed, ...)` whose placement tree's boxes are fitted: each node's box the union of its members' world
 *  boxes — a group's the placements' (the cube's, through the placement's world), a cell's its children's —, as the
 *  tree's refit leaves them, where the packed tree holds boxes that are infinite and visits every member. */
export function fittedWorld(
  count: number,
  seed: number,
  options: Parameters<typeof world>[2] = {},
) {
  const scene = world(count, seed, options)
  const tree = scene.packed.placementTree
  if (!tree) return scene
  const { buffer, byteOffset, length } = tree.nodes
  const words = new Uint32Array(buffer, byteOffset, length)
  const floats = new Float32Array(buffer, byteOffset, length)
  const matrices = new Float32Array(
    scene.packed.worlds.buffer,
    scene.packed.worlds.byteOffset,
    count * 16,
  )
  const stride = 20
  const nodes = length / stride
  for (let n = nodes - 1; n >= 0; n--) {
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity]
    const first = words[n * stride + NODE_FIRST_CHILD]
    for (let k = 0; k < words[n * stride + NODE_CHILD_COUNT]; k++) {
      const w = words[n * stride + NODE_KIND] === TREE_GROUP ? tree.order[first + k] : -1
      if (w >= count) continue
      for (let a = 0; a < 3; a++) {
        // A unit cube turned and stretched: its half extent through the world's linear part.
        const half =
          w < 0
            ? 0
            : [0, 1, 2].reduce((sum, c) => sum + 0.5 * Math.abs(matrices[w * 16 + c * 4 + a]), 0)
        const centre = w < 0 ? 0 : matrices[w * 16 + 12 + a]
        low[a] = Math.min(low[a], w < 0 ? floats[(first + k) * stride + a] : centre - half)
        high[a] = Math.max(high[a], w < 0 ? floats[(first + k) * stride + 4 + a] : centre + half)
      }
    }
    for (let a = 0; a < 3; a++) {
      floats[n * stride + a] = low[a]
      floats[n * stride + 4 + a] = high[a]
    }
    scene.tree.set('Node', n, words.subarray(n * stride, (n + 1) * stride))
  }
  return scene
}

/** Unit cubes at the x of `xs` on one line, the first `glass` of them blended: a ray along +x meets a blended cube's two faces. */
export function cubesAlong(xs: number[], glass = 0) {
  return world(xs.length, 1, {
    places: xs.map((x) => new Matrix4().makeTranslation(x, 0, 0)),
    surfaces: [
      [1, 0.5, 0.25, 1, 0, 0, 0, 0],
      [0.2, 0.4, 1, 0.5, 0, 0, 0, SURFACE_BLENDED],
    ],
    surfaceOf: (w) => (w < glass ? 1 : 0),
  })
}

/** What `sceneStage` is run with: the half-extents of the cascades' cubes about the origin (eight cells a side), a
 *  ring's budget in units (its tests the whole), the detail window's budget and its length, the flags of the stages
 *  that run, the eye, the metres a ray leaves a surface by along itself. */
export type SceneStage = {
  halves?: number[]
  work: number
  detail?: { work: number; distance: number; end?: number }
  traced?: boolean
  eye?: Vec3
  bias?: number
  /** The certified error of the proxy, metres. */
  error?: number
}

/**
 * The scene stage's walk (`reflectionProxied`, the shipped WGSL) over the proxy of `scene`: a ray from `origin` along
 * `direction`, which the screen stopped knowing at `left`, answered, with how it ended (`fate`) and the units it spent
 * (`work`). `pixel` is the pixel whose noise the detail window is taken against.
 */
export function sceneStage(scene: ReturnType<typeof world>, stage: SceneStage) {
  const { halves = [], work, detail, traced = true, eye = [0, 0, 0], bias = 0, error = 0 } = stage
  const text = `${wgslModule(REFLECTION_PROXY_WGSL)}
fn testFate()->u32{return reflectionFate;}
fn testWork()->u32{return reflectionWork;}`
  const flags =
    (traced ? REFLECTION_COUNTS.REFLECTION_SCENE_TRACES : 0) |
    (detail ? REFLECTION_COUNTS.REFLECTION_DETAIL_TRACES : 0)
  const run = shaderRun<{
    reflectionProxied: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      left: number,
      bound: number,
      pixel: number[],
    ) => { answer: { color: Vec3; confidence: number; distance: number }; open: number }
    reflectionLobeOf: (R: Vec3, alpha: number, lobe: number[]) => object
    testFate: () => number
    testWork: () => number
  }>(text, ['reflectionProxied', 'reflectionLobeOf', 'testFate', 'testWork'], {
    bounce: {
      counts: [8, halves.length, 0, halves.length ? 1 : 0],
      levels: halves.map((half) => ({ base: [-4, -4, -4], spacing: half / 4 })),
      reach: [200, 0, 0, 0],
    },
    view: { camera: [...eye, 1] },
    reflectionView: {
      slab: [1, 0, 0, 1],
      scene: [defaultReflections().screenSteps, work, 1e6, flags],
      detail: [detail?.work ?? 0, 1e6, 0, defaultReflections().ringResolution],
      reach: [detail?.distance ?? 0, detail?.end ?? 40, bias, 0],
    },
    reflectionDone: (bit: number) => (flags & bit) !== 0,
    rtProxy: { ...scene.header, error },
    rtWorlds: scene.worlds,
    rtTree: scene.tree,
    ...RT_PRIVATE_STATE,
    reflectionFate: 0,
    reflectionWork: 0,
    surfaceLit: (tint: Vec3) => tint,
    reflectionSeenAt: (tint: Vec3, emission: Vec3) => tint.map((c, k) => c + emission[k]),
  })
  return (origin: Vec3, direction: Vec3, bound = 1e9, pixel = [0, 0], left = 0) => {
    const lobe = run.reflectionLobeOf(direction, 0, [0, 0, 0, 0])
    const out = run.reflectionProxied(origin, [0, 1, 0], lobe, left, bound, pixel)
    return { ...out, fate: REFLECTION_FATES[run.testFate()], work: run.testWork() }
  }
}
