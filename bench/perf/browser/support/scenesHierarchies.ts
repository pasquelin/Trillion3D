// Parent/child hierarchies of the volume bench. World matrices come from Three.js —
// `updateMatrixWorld(true)` on real `Object3D` chains — the in-house hierarchy being separate:
// what is verified here is that volumes stay exact under any realistic world
// matrix. Depth chains 1 to 6 and a multi-child branch; negative scales on one or three
// axes, non-uniform under a parent rotation (shear), zero, extremes; a perspective or
// orthographic camera posed itself in the hierarchy.
import * as THREE from 'three'
import { xorshiftRandom } from '../../../core/index.ts'
import { dansDe } from './scenesCore.ts'
import { boxes } from './scenesVolumes.ts'
import { length3 } from '../../../../packages/math/src/vector/vector.ts'

const alea = xorshiftRandom(60617)
const dans = dansDe(alea)

/** Scales of a node: ordinary, negative on one or three axes, non-uniform, zero, extremes. */
const SCALES: (() => [number, number, number])[] = [
  () => [1, 1, 1],
  () => [-1, 1, 1],
  () => [-2, -0.5, -3],
  () => [0.1 + alea() * 4, 0.1 + alea() * 0.2, 1 + alea() * 9],
  () => [1, 0, 1],
  () => [1e-150, 1e150, 1],
  () => [-0.001, 1000, -7],
]

function node(depth: number) {
  const n = new THREE.Object3D()
  n.position.set(dans(40), dans(40), dans(40))
  n.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI))
  n.scale.fromArray(SCALES[(depth + Math.floor(alea() * 7)) % SCALES.length]())
  return n
}

const root = new THREE.Object3D(),
  nodes: THREE.Object3D[] = []
/** Depth chains 1 to 6 under the root. */
for (let string = 0; string < 24; string++) {
  let parent = root
  const depth = 1 + (string % 6)
  for (let d = 0; d < depth; d++) {
    const n = node(d)
    parent.add(n)
    nodes.push(n)
    parent = n
  }
}
/** A multi-child branch, including a rotated parent at non-uniform scale: shear. */
const branche = node(3)
branche.scale.set(3, 0.25, 1)
root.add(branche)
nodes.push(branche)
for (let i = 0; i < 5; i++) {
  const child = node(i)
  child.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI))
  branche.add(child)
  nodes.push(child)
  const petit = node(i + 2)
  child.add(petit)
  nodes.push(petit)
}

/** Cameras posed in the hierarchy, under parents of every scale. */
const cameras: (THREE.OrthographicCamera | THREE.PerspectiveCamera)[] = []
for (let i = 0; i < 16; i++) {
  const camera =
    i % 4 === 3
      ? new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 400)
      : new THREE.PerspectiveCamera(30 + alea() * 70, 0.6 + alea() * 1.6, 0.05 + alea(), 600)
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem
  camera.updateProjectionMatrix()
  camera.position.set(dans(10), dans(10), dans(10))
  camera.rotation.set(dans(Math.PI), dans(Math.PI), dans(Math.PI))
  nodes[(i * 7) % nodes.length].add(camera)
  cameras.push(camera)
}
root.updateMatrixWorld(true)

/** The world matrix of each node, as Three.js composes it. */
export const hierarchicalWorlds = nodes.map((n) => n.matrixWorld.toArray())

/** Each node against a few boxes: what the box transform and the sphere receive. */
export const hierarchicalBoxes: [number[], number[]][] = hierarchicalWorlds.flatMap((m, i) =>
  boxes
    .filter((_: number[], j: number) => j % 9 === i % 9)
    .map((b: number[]): [number[], number[]] => [b, m]),
)

/** View-projections of the hierarchy cameras, and world boxes of the nodes, one around the eye. */
export const hierarchicalViews = cameras.map((camera) => {
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  return {
    vp: new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .toArray(),
    eye: [eye.x, eye.y, eye.z],
  }
})
export const hierarchicalViewBoxes = hierarchicalViews.flatMap(({ vp, eye }, v) => {
  const [x, y, z] = eye
  const world = new THREE.Box3()
  const choisies = hierarchicalBoxes.filter((_, j) => j % 23 === v % 23)
  return [
    [x - 0.5, y - 0.5, z - 0.5, x + 0.5, y + 0.5, z + 0.5],
    ...choisies.map(([b, m]) => {
      world.min.set(b[0], b[1], b[2])
      world.max.set(b[3], b[4], b[5])
      world.applyMatrix4(new THREE.Matrix4().fromArray(m))
      return [...world.min.toArray(), ...world.max.toArray()]
    }),
  ].map((box) => ({ vp, box }))
})

/** Cones under the hierarchy world matrices: Three's normal matrix, a camera's eye. */
export const hierarchicalCones = hierarchicalBoxes.map(([b, m], i) => {
  const world = new THREE.Matrix4().fromArray(m)
  const e = world.elements
  return {
    axe: [dans(1), dans(1), dans(1)],
    angle: alea() * (Math.PI / 2),
    min: b.slice(0, 3),
    max: b.slice(3, 6),
    world,
    normal: new THREE.Matrix3().getNormalMatrix(world),
    scale: length3(e[0], e[1], e[2]),
    eye: hierarchicalViews[i % hierarchicalViews.length].eye,
  }
})
