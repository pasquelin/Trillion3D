// Hierarchy-equivalence scenarios (batch M3a), replayed on both sides by
// `hierarchyReplayThree.ts` and `hierarchyReplayEngine.ts`.
// Drawn from a fixed seed: two runs play the exact same operations.
import { xorshiftRandom } from '../../../core/index.ts'
import { dansDe } from './scenesCore.ts'
import type { CameraOptics } from '../../../../packages/sdk-browser/src/camera/engineCamera.ts'

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type CameraSpec = CameraOptics & { webgpu: boolean }
export type Pose = [Vec3, Quat, Vec3]

/**
 * One replayed operation, tagged by its first element and read the same way by
 * `hierarchyReplayThree.ts` and `hierarchyReplayEngine.ts`. `add` (parent, position, quaternion,
 * scale, camera or none), `pose` (position, quaternion, scale, each or `null`), `local` (posed
 * local matrix), `auto` (`matrixAutoUpdate`), `rattache` (new parent, `-1` to detach), `retire`
 * (the node and its descendants, listed), `maj` (`updateMatrixWorld(force)`), `updateWorld`
 * (`updateWorldMatrix(parents, children)`), `vise` (`lookAt` with an up), `objectif` (new camera
 * settings), `lis` (world reads of a node), `image` (view, view-projection and planes of a
 * camera), `instantane` (world matrices of all live nodes).
 */
export type HierarchyOp =
  | ['add', number, number, Vec3, Quat, Vec3, CameraSpec | null]
  | ['pose', number, Vec3 | null, Quat | null, Vec3 | null]
  | ['local', number, number[]]
  | ['auto', number, boolean]
  | ['rattache', number, number]
  | ['retire', number, number[]]
  | ['maj', number, boolean]
  | ['updateWorld', number, boolean, boolean]
  | ['vise', number, Vec3, Vec3]
  | ['objectif', number, CameraSpec]
  | ['lis', number]
  | ['image', number, boolean]
  | ['instantane', number]

const alea = xorshiftRandom(0x3a3a)
const tire = <T>(list: T[]): T => list[Math.floor(alea() * list.length)]
const dans = dansDe(alea)
const tourne = (): Quat => {
  const q: Quat = [alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5]
  const l = Math.hypot(...q)
  return q.map((c) => c / l) as Quat
}

/** Hostile positions, rotations and scales: ±0, extremes, NaN, infinities, mirrors, zeros. */
const POSITIONS: Vec3[] = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [1e150, -1e150, 1e-300],
  [NaN, 0, 1],
  [Infinity, -Infinity, 0],
]
const ROTATIONS: Quat[] = [
  [0, 0, 0, 1],
  [-0, -0, -0, -1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  [1e-9, 0, 0, 1],
  [1, 2, 3, 4],
  [NaN, 0, 0, 1],
]
const SCALES: Vec3[] = [
  [1, 1, 1],
  [-1, 1, 1],
  [1, -1, 1],
  [1, 1, -1],
  [-1, -1, -1],
  [2, 0.5, 3],
  [-2, 3, 0.25],
  [0, 1, 1],
  [0, 0, 0],
  [-0, 1, 1],
  [1e-300, 1, 1],
  [1e150, 1e150, 1e150],
  [Infinity, 1, 1],
  [NaN, 1, 1],
]

/** An ordinary pose: what a real scene carries, scales from 0.5 to 2, one in four mirrored. */
const ordinaire = (): Pose => [
  [dans(50), dans(50), dans(50)],
  tourne(),
  [(alea() < 0.25 ? -1 : 1) * (0.5 + alea() * 1.5), 0.5 + alea() * 1.5, 0.5 + alea() * 1.5],
]
/** A hostile pose once every `rarete`, ordinary otherwise. */
const pose = (rarete: number): Pose =>
  alea() * rarete < 1 ? [tire(POSITIONS), tire(ROTATIONS), tire(SCALES)] : ordinaire()

export const cameraAuHasard = (): CameraSpec => ({
  fov: 20 + alea() * 100,
  aspect: 0.5 + alea() * 2,
  near: 0.01 + alea(),
  far: 100 + alea() * 1000,
  zoom: alea() < 0.5 ? 1 : 0.5 + alea() * 3,
  webgpu: alea() < 0.5,
})

/** Live descendants of `id`, itself included, from the parents held by the generator. */
export function subtree(parents: number[], vivants: boolean[], id: number): number[] {
  const pris = new Set([id])
  for (let change = true; change;) {
    change = false
    parents.forEach((p, n) => {
      if (!vivants[n] || pris.has(n) || !pris.has(p)) return
      pris.add(n)
      change = true
    })
  }
  return [...pris]
}

const finies = <T extends number[]>(list: T[]): T[] => list.filter((v) => v.every(Number.isFinite))

/**
 * Frozen chains: depths 1 to 6 under roots, branches of five children each carrying three
 * levels, a camera under one chain in five, hostile scale and rotation at every level.
 * Then a forced update, a snapshot, reads of every node and frames of every camera in both
 * plane conventions. `nonFinies` false drops NaN and infinities, which would win the whole
 * subtree and hide a delta behind a shared NaN.
 */
export function chainesFigees(nonFinies: boolean): HierarchyOp[] {
  const positions = nonFinies ? POSITIONS : finies(POSITIONS),
    rotations = nonFinies ? ROTATIONS : finies(ROTATIONS),
    scales = nonFinies ? SCALES : finies(SCALES)
  const ops: HierarchyOp[] = [],
    roots: number[] = [],
    cameras: number[] = []
  let id = 0
  const add = (parent: number, k: number, level: number, camera: CameraSpec | null = null) => {
    ops.push([
      'add',
      id,
      parent,
      positions[(k + level) % positions.length],
      rotations[(k * 3 + level) % rotations.length],
      scales[(k * 7 + level * 5) % scales.length],
      camera,
    ])
    if (parent < 0) roots.push(id)
    if (camera) cameras.push(id)
    return id++
  }
  for (let k = 0; k < 48; k++) {
    let parent = -1
    for (let level = 0; level <= k % 6; level++) parent = add(parent, k, level)
    if (k % 5 === 0) add(parent, k, 7, cameraAuHasard())
  }
  for (let k = 0; k < 8; k++) {
    const branche = add(-1, k, 0)
    for (let child = 0; child < 5; child++) {
      let parent = branche
      for (let level = 1; level <= 3; level++) parent = add(parent, k + child, level)
    }
  }
  for (const r of roots) ops.push(['maj', r, true])
  ops.push(['instantane', 0])
  for (let n = 0; n < id; n++) ops.push(['lis', n])
  for (const c of cameras) ops.push(['image', c, false], ['image', c, true])
  return ops
}

export { alea, dans, pose, tire }
