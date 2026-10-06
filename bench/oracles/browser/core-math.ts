// Oracles of the math foundation: the code that is not attached to the
// foundation, copied as-is. These copies are wanted
// duplicates — it is against them that attached consumers are opposed, value by value, by `Object.is`.
import * as THREE from 'three'
import type { NumberSink } from '../../../packages/sdk-core/src/index.ts'

/** `packages/sdk-browser/src/webgpu/pages/render/winding.ts:23-28` from before: winding, determinant expanded inline. */
export function referenceWindingCw(e: NumberSink) {
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0
  )
}

/** `packages/sdk-browser/src/visibility/projection.ts:5-34` from before: clip space written inline. */
const projectScratch = new THREE.Vector3()
/** The three coordinates of a vertex, as a host geometry attribute yields them. */
interface VertexReader {
  getX(index: number): number
  getY(index: number): number
  getZ(index: number): number
}
export function referenceProjectVisibilityVertex(
  matrix: THREE.Matrix4,
  position: VertexReader,
  vi: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
) {
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(matrix)
  const e = viewProj.elements
  const cx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12],
    cy = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13],
    cz = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14],
    cw = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15]
  if (cw === 0 || !Number.isFinite(cw)) return null
  const ndcX = cx / cw,
    ndcY = cy / cw,
    ndcZ = cz / cw
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    z: ndcZ,
    invW: 1 / cw,
    worldX: v.x,
    worldY: v.y,
    worldZ: v.z,
  }
}

/** `packages/sdk-browser/src/visibility/math.ts:97-106` from before: the sRGB table and 8-bit encoding written inline. */
export function referenceSrgb8Linear(octet: number) {
  const c = octet / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
export function referenceLinearToSrgb8(c: number) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}
