// Generated fields of trees and a camera that sways over them, as the watch's tests read them.
import type { ImpostorRoot } from './plan.ts'
import { impostorViewCosine } from './watch.ts'
import { bakedMesh } from './bakedMesh.fixture.ts'
import { createHeap } from '../../../math/src/sequence/heap.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'

export const FOCAL = 1117
export const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 }
export const section: ImpostorSection = {
  ...{ version: 1, frames: 12, focalPixels: FOCAL, textureLimit: 8192, baked: 1, refused: 0 },
  meshes: [bakedMesh(1, 'tree', TREE)],
}
/** A perspective of 60° vertically at 16:9, reversed and infinite. */
export const PROJECTION = (() => {
  const f = 1 / Math.tan(Math.PI / 6)
  return Float64Array.of(f / (16 / 9), 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0)
})()
export const COS = impostorViewCosine(PROJECTION)

/** `count` trees at one per 400 m² on a disk about the origin, a few scaled or another mesh-less. */
export function field(count: number): ImpostorRoot[] {
  const radius = Math.sqrt((count * 400) / Math.PI)
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: count }, (_, k) => {
    const r = radius * Math.sqrt(next()),
      a = 2 * Math.PI * next(),
      s = k % 7 === 0 ? 1.5 : 1
    const elements = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, r * Math.cos(a), 0, r * Math.sin(a), 1]
    return { mesh: k % 11 === 0 ? undefined : 1, world: { elements } }
  })
}

/** The view of an eye at `eye` turned by `yaw` about the vertical, looking down −z at rest. */
export function viewAt(eye: readonly number[], yaw: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw)
  // The camera's axes in the world: right (c, 0, −s), up (0, 1, 0), back (s, 0, c); the view is
  // their transpose, the eye taken off.
  const view = Float64Array.of(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1)
  for (let i = 0; i < 3; i++)
    view[12 + i] = -(view[i] * eye[0] + view[4 + i] * eye[1] + view[8 + i] * eye[2])
  return view
}

/** Whether root `root`'s pivot is in `view`'s frustum (`PROJECTION`, no far plane). */
export function inView(view: Float64Array, root: ImpostorRoot) {
  const w = root.world.elements,
    p = [0, 1, 2].map(
      (i) => view[i] * w[12] + view[4 + i] * w[13] + view[8 + i] * w[14] + view[12 + i],
    )
  if (p[2] >= 0) return false
  return Math.abs(p[0] * PROJECTION[0]) <= -p[2] && Math.abs(p[1] * PROJECTION[5]) <= -p[2]
}

/** Frame `k` of a camera swaying about `[x, 2, z]`: a metre aside and a degree about the vertical,
 *  `turn` adding a slow sweep of the view. */
export function swayAt(k: number, turn = 0) {
  const eye = [Math.sin(k * 0.21), 2, 0.6 * Math.cos(k * 0.13)]
  return viewAt(eye, (Math.PI / 180) * Math.sin(k * 0.17) + turn * k)
}

/** The heaps a watch is handed (`createImpostorWatch`), each kept: the roots waiting in them, and
 *  the pushes made while `counting`. */
export function keptHeaps() {
  const heaps = new Set<ReturnType<typeof createHeap<number>>>()
  const kept = {
    counting: true,
    pushes: 0,
    /** Roots waiting in every heap made. */
    waiting: () => [...heaps].reduce((sum, heap) => sum + heap.size, 0),
    make: (
      before: (a: number, b: number) => boolean,
      placed: (rank: number, at: number) => void,
    ) => {
      const heap = createHeap(before, placed),
        push = heap.push
      heap.push = (rank) => ((kept.pushes += kept.counting ? 1 : 0), push(rank))
      heaps.add(heap)
      return heap
    },
  }
  return kept
}
