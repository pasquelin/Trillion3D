// A closed room for the reflection proofs: six slabs seen from inside (`boxFrame.ts`) of nearly one
// grey, a glossy metal patch in the middle of its floor, and its proxy (`rig.ts`): the
// twelve triangles of its inner faces, each face giving its colour. A ray that
// leaves the screen finds the room again in the proxy, and never the background. The patch lies
// metres from every wall. Its far wall's colour is a parameter (`roomFrame`): a dark one tells the
// proxy's answer from the background's.
import { boxFrame, type Block } from './boxFrame.ts'
import type { RigFrame } from './rigFrame.ts'
import type { RigFace } from './rigRuntime.ts'
import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'

/** The room's inner extent: x, y and z from `low` to `high`. */
const LOW: Vec3 = [-5, 0, -10],
  HIGH: Vec3 = [5, 4, 0]
const THICK = 0.5

/** The faces of the room, each an axis, a side (0 low, 1 high), and its colour: nearly one grey, the
 *  largest channel `ROOM_MAXIMUM`. */
const FACES: { axis: number; side: number; color: Vec3 }[] = [
  { axis: 0, side: 0, color: [0.48, 0.5, 0.5] },
  { axis: 0, side: 1, color: [0.52, 0.5, 0.5] },
  { axis: 1, side: 0, color: [0.3, 0.3, 0.3] },
  { axis: 1, side: 1, color: [0.5, 0.52, 0.5] },
  { axis: 2, side: 0, color: [0.5, 0.5, 0.52] },
  { axis: 2, side: 1, color: [0.5, 0.5, 0.48] },
]
/** The face at the far end of the view (low z). */
const FAR = 4
/** The largest radiance of the room's lit surfaces. */
export const ROOM_MAXIMUM = 0.52
/** The glossy patch of the floor, a film of two millimetres on it: no side of it shows. */
const PATCH: Block['box'] = { low: [-2, 0, -8], high: [2, 0.002, -2] }

/** The slab behind each face, thick outward. */
function slab(axis: number, side: number): Block['box'] {
  const low: Vec3 = [LOW[0] - THICK, LOW[1] - THICK, LOW[2] - THICK]
  const high: Vec3 = [HIGH[0] + THICK, HIGH[1] + THICK, HIGH[2] + THICK]
  if (side) low[axis] = HIGH[axis]
  else high[axis] = LOW[axis]
  return { low, high }
}

/** The room's proxy: two triangles to a face, and the radiance it gives. */
function roomProxy(faces: typeof FACES) {
  const proxy: RigFace[] = []
  for (const { axis, side, color } of faces) {
    const triangles: number[] = []
    const [u, v] = [0, 1, 2].filter((a) => a !== axis)
    const at = side ? HIGH[axis] : LOW[axis]
    const corner = (a: number, b: number): number[] => {
      const point = [0, 0, 0]
      point[axis] = at
      point[u] = a ? HIGH[u] : LOW[u]
      point[v] = b ? HIGH[v] : LOW[v]
      return point
    }
    for (const quad of [
      [corner(0, 0), corner(1, 0), corner(1, 1)],
      [corner(0, 0), corner(1, 1), corner(0, 1)],
    ]) {
      triangles.push(...quad.flat())
    }
    proxy.push({ triangles: Float32Array.from(triangles), radiance: color })
  }
  return { faces: proxy }
}

/** The room seen from `eye` toward `target`, `width × height` pixels: its glossy patch of
 *  roughness `rough`, the proxy beyond the screen, a white background; the far wall's colour is
 *  `far`, the room's own by default. */
export function roomFrame(
  eye: Vec3,
  target: Vec3,
  width: number,
  height: number,
  rough: number,
  far: Vec3 = FACES[FAR].color,
) {
  const faces = FACES.map((face, k) => (k === FAR ? { ...face, color: far } : face))
  const blocks: Block[] = faces.map(({ axis, side, color }) => ({ box: slab(axis, side), color }))
  // The patch is a glossy metal of roughness `rough`.
  const patch = blocks.push({ box: PATCH, color: faces[2].color, mirror: true, rough }) - 1
  const { frame, view, shown } = boxFrame(blocks, eye, target, width, height)
  const room: RigFrame = { ...frame, proxy: roomProxy(faces), background: 0xffffff }
  return { frame: room, view, shown, floor: patch }
}
