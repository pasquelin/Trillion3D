// A closed room for the reflection proofs: six slabs seen from inside (`boxFrame.ts`) of nearly one
// grey, a glossy metal patch in the middle of its floor, and its resident proxy (`rig.ts`): the
// twelve triangles of its inner faces, whose surface cache holds each face's colour. A ray that
// leaves the screen finds the room again in the proxy, and never the background. The patch lies
// metres from every wall, so that the cone of its lobe is wider than the proxy's cell where it
// meets them (`reflectionProxied`).
import { trianglesProxy } from '../../../packages/sdk-core/src/scene/core/proxy.fixture.ts'
import type { V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { boxFrame, type Block } from './boxFrame.ts'
import type { RigFrame } from './rig.ts'

/** The room's inner extent: x, y and z from `low` to `high`. */
const LOW: V3 = [-5, 0, -10],
  HIGH: V3 = [5, 4, 0]
const THICK = 0.5

/** The faces of the room, each an axis, a side (0 low, 1 high), and its colour: nearly one grey, the
 *  largest channel `ROOM_MAXIMUM`. */
const FACES: { axis: number; side: number; color: V3 }[] = [
  { axis: 0, side: 0, color: [0.48, 0.5, 0.5] },
  { axis: 0, side: 1, color: [0.52, 0.5, 0.5] },
  { axis: 1, side: 0, color: [0.3, 0.3, 0.3] },
  { axis: 1, side: 1, color: [0.5, 0.52, 0.5] },
  { axis: 2, side: 0, color: [0.5, 0.5, 0.52] },
  { axis: 2, side: 1, color: [0.5, 0.5, 0.48] },
]
/** The largest radiance of the room's lit surfaces. */
export const ROOM_MAXIMUM = 0.52
/** The glossy patch of the floor, a film of two millimetres on it: no side of it shows. */
const PATCH: Block['box'] = { low: [-2, 0, -8], high: [2, 0.002, -2] }

/** The slab behind each face, thick outward. */
function slab(axis: number, side: number): Block['box'] {
  const low: V3 = [LOW[0] - THICK, LOW[1] - THICK, LOW[2] - THICK]
  const high: V3 = [HIGH[0] + THICK, HIGH[1] + THICK, HIGH[2] + THICK]
  if (side) low[axis] = HIGH[axis]
  else high[axis] = LOW[axis]
  return { low, high }
}

/** The room's proxy: two triangles to a face, and the radiance of both sides of each. */
function roomProxy() {
  const triangles: number[] = []
  const surface: number[] = []
  for (const { axis, side, color } of FACES) {
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
      surface.push(...color, 1, ...color, 1)
    }
  }
  return {
    scene: { ...trianglesProxy(Float32Array.from(triangles), 6), cellMetres: 1 },
    surface: Float32Array.from(surface),
    reach: 100,
  }
}

/** The room seen from `eye` toward `target`, `width × height` pixels: its glossy patch of
 *  roughness `rough`, the proxy beyond the screen, a white background. */
export function roomFrame(eye: V3, target: V3, width: number, height: number, rough: number) {
  const blocks: Block[] = FACES.map(({ axis, side, color }) => ({ box: slab(axis, side), color }))
  const patch = blocks.push({ box: PATCH, color: FACES[2].color, mirror: true }) - 1
  const { frame, view, shown } = boxFrame(blocks, eye, target, width, height)
  // The patch is a glossy metal: its roughness, in every pixel it shows.
  for (let p = 0; p < width * height; p++)
    if (shown[p] >= 0 && Math.floor(shown[p] / 6) === patch) frame.normals[p * 4 + 3] = rough
  const room: RigFrame = { ...frame, proxy: roomProxy(), background: 0xffffff }
  return { frame: room, view, shown, floor: patch }
}
