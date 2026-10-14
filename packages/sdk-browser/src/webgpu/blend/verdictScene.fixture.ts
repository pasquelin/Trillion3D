// Adversarial scenes for the GPU frustum verdict (`verdictWgsl.test.ts`): boxes near the planes,
// one-ulp straddles, NaN, infinite and signed-zero boxes and planes, items with no box, hidden and
// parked items, paged items the cut emptied, all around an eye that may lie far from the origin.
import * as G from '../../host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import type { BlendGpuItem } from './state.ts'

const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE, -Number.MAX_VALUE, 5e-324]

/** A box near the frustum's planes around `eye`, a bound sometimes one ulp across, or a special
 *  value. */
function box(next: () => number, edges: boolean, eye: number[]) {
  const c = [0, 1, 2].map((axis) => eye[axis] + (next() - 0.5) * 40),
    r = next() * 6
  const bounds = new Float64Array([c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r])
  if (next() < 0.2) {
    // One bound moved onto the axis plane x = 10 from the eye, or one ulp either side of it.
    const side = next() < 0.5 ? 0 : 3,
      plane = eye[0] + 10
    bounds[side] = [plane - plane * 2 ** -52, plane, plane + plane * 2 ** -52][
      Math.floor(next() * 3)
    ]
  }
  if (edges && next() < 0.1)
    bounds[Math.floor(next() * 6)] = EDGES[Math.floor(next() * EDGES.length)]
  return bounds
}

/** Six planes: an axis box around `eye` with one face on x = 10 from it, or random half-spaces
 *  through points around it. */
function planes(into: Float64Array, next: () => number, edges: boolean, eye: number[]) {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1,
      sign = p & 1 ? -1 : 1
    const tilted = next() < 0.3
    const n = tilted ? [next() - 0.5, next() - 0.5, next() - 0.5] : [0, 0, 0]
    if (!tilted) n[axis] = sign
    const reach = p === 1 ? 10 : 5 + next() * 20
    into.set([n[0], n[1], n[2], reach - n[0] * eye[0] - n[1] * eye[1] - n[2] * eye[2]], p * 4)
  }
  if (edges && next() < 0.3)
    into[Math.floor(next() * 24)] = EDGES[Math.floor(next() * EDGES.length)]
}

/** A scene of `count` items around `eye`, its paged ranks and their counts as the compaction left
 *  them. */
export function verdictScene(count: number, next: () => number, edges: boolean, eye = [0, 0, 0]) {
  const items: BlendGpuItem[] = []
  let water = 0
  for (let i = 0; i < count; i++) {
    const transmissive = next() < 0.25
    items.push({
      surface: surfaceOf(G.basicSurface({ side: Math.floor(next() * 3) })),
      matrix: new Matrix4().makeTranslation(next() * 50, 0, next() * 50),
      count: 3,
      transmissive,
      flags: transmissive ? ++water << WATER_RANK_SHIFT : 0,
      hidden: next() < 0.1,
      bounds: next() < 0.9 ? box(next, edges, eye) : undefined,
      placement: {
        rows: { live: new Uint8Array([next() < 0.1 ? 0 : 1]) },
        index: 0,
      } as unknown as PlacementOf,
    } as unknown as BlendGpuItem)
  }
  const blendState = blendSceneOf(items)
  blendState.transmissive = water
  planes(blendState.blendPlanes, next, edges, eye)
  // Paged items read the compaction's count at their paged rank: some the cut emptied.
  const counts: number[] = []
  items.forEach((_, i) => {
    if (next() >= 0.5) return
    blendState.drawsPacked[i * 4] = counts.length / 4
    counts.push(0, next() < 0.3 ? 0 : 1 + Math.floor(next() * 9), 0, 0)
  })
  orderBlendPasses(blendState, eye)
  return { blendState, counts }
}
