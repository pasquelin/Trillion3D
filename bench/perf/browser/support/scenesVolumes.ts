// Inputs of the volume-equivalence bench: drawn from a seed, and deliberately
// hostile. Empty, inverted, point, infinite boxes, NaN or signed-zero bounds; placement
// matrices with negative or non-uniform scale, singular, projective, full of NaN;
// perspective and orthographic views; boxes that contain
// the eye, hence clip the near plane.
import * as THREE from 'three'
import { xorshiftRandom } from '../../../core/index.ts'
import { dansDe } from './scenesCore.ts'
import { boxCenter } from '../../../../packages/math/src/geometry/box.ts'
import { HALF_PI } from '../../../../packages/math/src/constants.ts'

const alea = xorshiftRandom(52021)
/** Values a float can take that a volume must traverse without smoothing them. */
const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, 1e308, -1e308]
const count = (): number => {
  if (alea() < 0.15) return BORDS[Math.floor(alea() * BORDS.length)]
  return (alea() * 2 - 1) * 10 ** Math.floor(alea() * 10 - 4)
}
const dans = dansDe(alea)

/** Six bounds: ordinary, then the degenerate shapes the engine may receive from a manifest. */
export const boxes: number[][] = [
  [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
  [1, 1, 1, 0, 0, 0],
  [-1, -1, -1, 1, -2, 1],
  [2, 3, 4, 2, 3, 4],
  [-0, -0, -0, 0, 0, 0],
  [0, 0, 0, -0, -0, -0],
  [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
  [NaN, 0, 0, 1, 1, 1],
  [0, 0, 0, 1, NaN, 1],
  [-0.5, -0.5, 5.5, 0.5, 0.5, 6.5],
  [-1e308, -1e308, -1e308, 1e308, 1e308, 1e308],
]
for (let i = 0; i < 300; i++) {
  if (i % 5 === 0) {
    boxes.push([count(), count(), count(), count(), count(), count()])
    continue
  }
  const c = [dans(20), dans(20), dans(20)],
    e = [alea() * 4, alea() * 4, alea() * 4]
  boxes.push([c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]])
}

const placement = (sx: number, sy: number, sz: number): number[] => {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(dans(Math.PI), dans(Math.PI), dans(Math.PI)),
  )
  return new THREE.Matrix4()
    .compose(new THREE.Vector3(dans(50), dans(50), dans(50)), q, new THREE.Vector3(sx, sy, sz))
    .toArray()
}

/** 4×4 column-major placement matrices. */
export const matrices: number[][] = [
  new THREE.Matrix4().toArray(),
  new Array(16).fill(0),
  new Array(16).fill(-0),
  new THREE.Matrix4().makeScale(1, 0, 1).toArray(),
  new THREE.Matrix4().makeScale(-1, 1, 1).toArray(),
  new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, -0.1, 0.3, 1).toArray(),
]
for (let i = 0; i < 40; i++) {
  const u = alea() * 3 + 0.01
  matrices.push(placement(u, u, u))
  matrices.push(placement(dans(3), dans(3), dans(3)))
  const hostile = placement(u, -u, u)
  hostile[Math.floor(alea() * 16)] = count()
  matrices.push(hostile)
}

/** One view: a `[0, 1]` view-projection, and the eye it was built from. */
export interface ViewProjectionCase {
  vp: number[]
  eye: number[]
}

/** View-projections: perspective and orthographic, in WebGPU's `[0, 1]` depth, and hostile. */
export const projectionViews: ViewProjectionCase[] = []
for (let i = 0; i < 60; i++) {
  const camera =
    i % 4 === 3
      ? new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 300)
      : new THREE.PerspectiveCamera(20 + alea() * 90, 0.5 + alea() * 2, 0.01 + alea(), 500)
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem
  camera.updateProjectionMatrix()
  camera.position.set(dans(30), dans(30), dans(30))
  camera.lookAt(dans(5), dans(5), dans(5))
  camera.updateMatrixWorld()
  const vp = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray()
  if (i % 9 === 8) vp[Math.floor(alea() * 16)] = count()
  const eye = camera.position
  projectionViews.push({ vp, eye: [eye.x, eye.y, eye.z] })
}
projectionViews.push({ vp: new Array(16).fill(0), eye: [0, 0, 0] })
projectionViews.push({ vp: new Array(16).fill(NaN), eye: [0, 0, 0] })

/** One view against one box: the shared ones, and a box around the eye that clips the near plane. */
export interface ViewBoxCase {
  vp: number[]
  box: number[]
}

/** Each view against boxes: the shared ones, and a box around the eye that clips the near plane. */
export const viewBoxes: ViewBoxCase[] = projectionViews.flatMap(({ vp, eye }, v) => {
  const [x, y, z] = eye
  const autour = [x - 1, y - 1, z - 1, x + 1, y + 1, z + 1]
  return [autour, ...boxes.filter((_, i) => i % 7 === v % 7)].map((box) => ({ vp, box }))
})

/** One cone-rejection case: conformal placement, cone, box, eye. */
export interface ConeCase {
  axe: number[]
  angle: number
  min: number[]
  max: number[]
  world: THREE.Matrix4
  normal: THREE.Matrix3
  scale: number
  eye: number[]
}

/** Cone rejections: conformal placement, cone, box, eye — sometimes in the sphere, sometimes hostile. */
export const casCones: ConeCase[] = []
for (let i = 0; i < 1500; i++) {
  const u = i % 13 === 0 ? count() : alea() * 3 + 0.01
  const world = new THREE.Matrix4().fromArray(placement(u, u, i % 3 === 0 ? -u : u))
  const axe = [dans(1), dans(1), dans(1)]
  if (i % 17 === 0) axe[i % 3] = count()
  const box = boxes[i % boxes.length]
  const mid = new Float64Array(3)
  boxCenter(mid, 0, box[0], box[1], box[2], box[3], box[4], box[5])
  const centre = new THREE.Vector3(mid[0], mid[1], mid[2]).applyMatrix4(world)
  const eye =
    i % 11 === 0
      ? [centre.x, centre.y, centre.z]
      : [centre.x + dans(80), centre.y + dans(80), centre.z + dans(80)]
  casCones.push({
    axe,
    angle: i % 19 === 0 ? count() : alea() * HALF_PI,
    min: box.slice(0, 3),
    max: box.slice(3, 6),
    world,
    normal: new THREE.Matrix3().getNormalMatrix(world),
    scale: u,
    eye,
  })
}
