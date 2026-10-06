// The "transparents in a few orders" bench scene and its frames: twelve placements per
// paged prototype, a few primitives that carry their own buffers, and three camera
// regimes. Both sides of the bench each build a copy, so neither benefits from the
// state the other leaves.
import * as THREE from 'three'
import { GraphSurface } from '../../../../packages/sdk-browser/src/host/graph/surface.ts'
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts'
import {
  createWebgpuBlendState,
  type BlendGpuItem,
} from '../../../../packages/sdk-browser/src/webgpu/blend/state.ts'
import {
  buildBlendStatics,
  refreshBlendPlan,
} from '../../../../packages/sdk-browser/src/webgpu/blend/plan.ts'
import { xorshiftRandom } from '../../../core/index.ts'
import { planReference } from '../../../oracles/browser/transparent-orders.ts'

type BlendState = ReturnType<typeof createWebgpuBlendState>

/** The reduced item this bench builds: only the fields the blend order reads (no GPU buffers),
 *  picked from the engine's item so a renamed field fails the type check, not the bench run. */
export type BenchItem = Pick<
  BlendGpuItem,
  'surface' | 'count' | 'paged' | 'pagedIndex' | 'tableBase'
> & { matrix: THREE.Matrix4; bounds: Float64Array }

/** Order of magnitude of the measured scene: 4 288 transparent items, twelve placements each. */
const PLACEMENTS = 12,
  PROTOTYPES = 357,
  ISOLES = 4,
  PAGINES = PROTOTYPES * PLACEMENTS
export const ITEMS = PAGINES + ISOLES
/** What a paged primitive holds in the catalogue, and the vertices of a cluster. */
const CLUSTERS = 8,
  MOTS = 48

const alea = xorshiftRandom(31)

/**
 * Both sides of a transparent scene, and why the bench measures both.
 *
 * Both paths yield one entry for a single-sided material and two, back then front, for a
 * double-sided material. The reference changes pipelines between faces; the current paged
 * path culls in the vertex stage so both faces can share a run. Keep both cases measured.
 */
export const FACES: [string, THREE.Side][] = [
  ['single-sided', THREE.FrontSide],
  ['double-sided', THREE.DoubleSide],
]

/**
 * The scene: twelve placements per prototype, plus four primitives that carry their buffers.
 * Reduced fixture: only the fields the blend order reads are populated (no real GPU buffers).
 */
function batisItems(side: THREE.Side): BenchItem[] {
  const items: BenchItem[] = [],
    surface = surfaceOf(new GraphSurface('basic', { side }))
  for (let i = 0; i < ITEMS; i++) {
    const paged = i < PAGINES
    const matrix = new THREE.Matrix4().setPosition(
      (i % 64) * 3 - 96,
      ((i >> 6) % 16) * 4,
      Math.floor(i / 1024) * 5,
    )
    const m = matrix.elements
    const bounds = new Float64Array([
      m[12] - 1,
      m[13] - 1,
      m[14] - 1,
      m[12] + 1,
      m[13] + 1,
      m[14] + 1,
    ])
    items.push({
      surface,
      matrix,
      bounds,
      count: paged ? 0 : 900,
      paged,
      pagedIndex: paged ? i : undefined,
      tableBase: paged ? i * CLUSTERS : 0,
    })
  }
  return items
}

/** The six half-spaces of a box centred on the eye: the frustum rule, without projection. */
function plansDe(x: number): Float64Array {
  const planes = new Float64Array(24)
  const pose = (p: number, a: number, b: number, c: number, d: number) => {
    planes[p * 4] = a
    planes[p * 4 + 1] = b
    planes[p * 4 + 2] = c
    planes[p * 4 + 3] = d
  }
  pose(0, 1, 0, 0, 110 - x)
  pose(1, -1, 0, 0, 110 + x)
  pose(2, 0, 1, 0, 40)
  pose(3, 0, -1, 0, 40)
  pose(4, 0, 0, 1, 400)
  pose(5, 0, 0, -1, 400)
  return planes
}

/** A frame: the eye, its planes, and the cut compaction would have written for each item. */
function imageA(x: number) {
  const counts = new Uint32Array(PAGINES),
    instances = new Uint32Array(PAGINES * CLUSTERS)
  for (let p = 0; p < counts.length; p++) {
    const tenues = 1 + Math.floor(alea() * CLUSTERS)
    counts[p] = tenues
    for (let j = 0; j < tenues; j++) instances[p * CLUSTERS + j] = p * CLUSTERS + j
  }
  return { eye: [x, 8, 0], planes: plansDe(x), counts, instances }
}
export type Frame = ReturnType<typeof imageA>

/**
 * Three regimes, eight frames each: the sliding camera — the round trip closes the loop, so
 * a lap does not chain onto a disguised jump —, the still pose, and the camera jump,
 * which fully renews the paint order.
 */
export const glisse: Frame[] = [0, 6, 12, 18, 24, 18, 12, 6].map(imageA)
export const regimes: [string, Frame[]][] = [
  ['sliding camera', glisse],
  ['still pose', Array.from({ length: 8 }, () => glisse[0])],
  ['camera jump', Array.from({ length: 8 }, (_, image) => imageA(image * 47 - 160))],
]

/** The span of each cluster in the page cache: the same table on both sides. */
export const spans = new Uint32Array(PAGINES * CLUSTERS * 2)
for (let e = 0; e < spans.length / 2; e++) {
  spans[e * 2] = e * MOTS
  spans[e * 2 + 1] = MOTS
}

/** One side of the bench: its blend state, its plan in the host format, and its output buffers. */
export function benchSide(side: THREE.Side) {
  const blendState: BlendState = createWebgpuBlendState()
  // Reduced fixture, matching the pattern already used by `packages/sdk-browser/src/webgpu/blend/plan.test.ts`: only the
  // fields the blend order reads are populated, not a full GPU `BlendGpuItem`.
  blendState.blendGpu.push(...(batisItems(side) as unknown as BlendGpuItem[]))
  blendState.table = {
    maxVertexWords: MOTS,
    capacity: PAGINES * CLUSTERS,
    length: PAGINES * CLUSTERS,
    itemRanges: Uint32Array.from({ length: PAGINES * 2 }, (_, k) =>
      k % 2 ? CLUSTERS : (k >> 1) * CLUSTERS,
    ),
  } as BlendState['table']
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  return {
    blendState,
    // The previous path's plan, in its own format: the batch put the share bit in the entry.
    order: planReference(blendState.blendGpu),
    scene: {
      items: blendState.blendGpu,
      draws: blendState.drawsPacked,
      planes: blendState.blendPlanes,
      spans,
      itemCounts: undefined as Uint32Array | undefined,
      instances: undefined as Uint32Array | undefined,
    },
    args: new Uint32Array(ITEMS * 4),
    // A double-sided item spreads its instances twice: one per plan entry.
    output: new Uint32Array((PAGINES * CLUSTERS + ISOLES) * 3 * 2),
  }
}
export type BenchSide = ReturnType<typeof benchSide>

/** What the frame gives both sides: the frustum planes and this frame's cut. */
export function pose(state: BenchSide, image: Frame) {
  state.blendState.blendPlanes.set(image.planes)
  state.scene.itemCounts = image.counts
  state.scene.instances = image.instances
  state.blendState.cpuItemCounts = image.counts
  state.blendState.cpuInstances = image.instances
}
