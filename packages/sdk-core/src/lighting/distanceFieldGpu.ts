import {
  DISTANCE_FIELD_KERNEL_DOUBT,
  DISTANCE_FIELD_KERNEL_DOUBTFUL,
  DISTANCE_FIELD_KERNEL_ECHO_MASK,
  DISTANCE_FIELD_KERNEL_ECHO_SHIFT,
  DISTANCE_FIELD_KERNEL_HEAD_WORDS,
  DISTANCE_FIELD_KERNEL_MAX_DEPTH,
  DISTANCE_FIELD_KERNEL_MIP_RECORDS,
  DISTANCE_FIELD_KERNEL_NONE,
} from './distanceFieldKernel.ts'
import {
  BRICK_VOXELS,
  cellOf,
  frameOf,
  quantise,
  voxelAt,
  volumeOf,
  type Frame,
  type MipGrid,
} from './distanceFieldGrid.ts'
import { enoughBackFaces, signedDistance, type Scene, type Vec3 } from './distanceFieldScene.ts'

/**
 * THE HOST HALF OF THE GPU MEASURE (`asset-compiler-rust/src/distance_field/gpu.rs` and `gpu/pack.rs`, which this follows step by
 * step). The program that measures the voxels is the compiler's own (`distanceFieldKernel.ts`, printed from its WGSL): one voxel an
 * invocation, the nearest triangle nearer than the trace distance, then the rays across the sphere. This packs what it reads — the
 * mesh's whole tree and its triangles in leaf order about the box centre in single precision, each marked two-sided or not, the rays and the
 * mips' volumes —, names the voxels of the bricks that hold a triangle's reach as the points it measures, and takes its results back:
 * the byte of each, and every voxel the kernel marked doubtful, dropped or wrote at another's place measured again on the CPU in double
 * precision (`distanceFieldScene.ts`), as is every voxel whose distance lies near a step of its byte. Every other one took the steps the
 * CPU takes, so its byte is the CPU's.
 */

/** A brick whose voxels are measured: its mip and its rank among the mip's cells. */
export interface Touched {
  readonly mip: number
  readonly rank: number
}

/** A voxel to measure again on the CPU: its rank among the job's voxels, and the distance the GPU gave when every step of it but the
 *  distance's own rounding was certain. */
export interface Doubtful {
  readonly at: number
  readonly settled?: number
}

/** What the kernel measures: the scene as it reads it, the voxels to measure, and the doubt in the scene's units. */
export interface VoxelJob {
  /** The scene words (`pack`). */
  readonly words: Uint32Array<ArrayBuffer>
  /** The doubt in the scene's units, and the mips the voxels lie in. */
  readonly doubt: number
  readonly mips: readonly MipGrid[]
  /** The voxels, a brick's after another's. */
  readonly count: number
  /** Writes the points of voxels `first` to `first + count` into `items`: four floats each, the position about the scene's origin and
   *  the mip. */
  fill(first: number, count: number, items: Float32Array): void
  /** The echo of the point of voxel `at`: what the kernel's second word holds if it measured that point. */
  echoOf(at: number): number
  /** The mip a voxel lies in. */
  mipOf(at: number): number
}

/** A device that measures a job: calls `land` with each run of results in turn, two words a voxel, the distance's bits then the second
 *  word (back faces met, echo, `DOUBTFUL`), the runs covering the job's voxels in order. */
export type VoxelKernel = (
  job: VoxelJob,
  land: (first: number, results: Uint32Array) => void,
) => Promise<void>

/** A scene the kernel cannot walk: the build is refused, never made otherwise. */
export class VoxelKernelRefused extends Error {}

const FLOATS = new Float32Array(1)
const BITS = new Uint32Array(FLOATS.buffer)
const f = Math.fround
const SHIFT = DISTANCE_FIELD_KERNEL_ECHO_SHIFT
const ECHO_MASK = DISTANCE_FIELD_KERNEL_ECHO_MASK
const DOUBTFUL = DISTANCE_FIELD_KERNEL_DOUBTFUL

/** The echo of the point `item` — its four floats' bits mixed —, as the kernel forms it from the point it read (`second` of
 *  `field.wgsl`), so a value measured at another point, or written at another voxel's place, is never taken. */
function echoOfPoint(item: Float32Array) {
  const [x, y, z, w] = new Uint32Array(item.buffer, item.byteOffset, 4)
  const mixed =
    (Math.imul(x, 0x9e3779b1) ^
      Math.imul(y, 0x85ebca77) ^
      Math.imul(z, 0xc2b2ae3d) ^
      Math.imul(w, 0x27d4eb2f)) >>>
    0
  return ((mixed ^ (mixed >>> 15)) >>> 0) & ECHO_MASK
}

/** The edges from the root to the deepest leaf of the tree. */
function depthOf({ left, right }: Scene['tree']) {
  let deepest = 0
  const stack = [[0, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()!
    deepest = Math.max(deepest, depth)
    if (left[node] >= 0) stack.push([left[node], depth + 1], [right[node], depth + 1])
  }
  return deepest
}

/** The least box of each node's triangles' packed corners, widened by `slack` (eight units in the last place of the largest corner, more
 *  than a pass's own rounding of a distance), so a box never prunes the triangle it holds: low corners then high corners, per node. */
function packedBoxes(
  { left, right, first, size }: Scene['tree'],
  corners: Float32Array,
  largest: number,
) {
  const count = left.length
  const boxes = new Float32Array(count * 6)
  const slack = f(8 * 2 ** -23 * largest)
  // Preorder: a node's children come after it in the walk, so the reverse of it has them first.
  const order: number[] = []
  for (const stack = [0]; stack.length;) {
    const node = stack.pop()!
    order.push(node)
    if (left[node] >= 0) stack.push(left[node], right[node])
  }
  for (let at = order.length - 1; at >= 0; at--) {
    const node = order[at]
    const own = boxes.subarray(6 * node, 6 * node + 6)
    own.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
    const grow = (low: ArrayLike<number>, high: ArrayLike<number>, from: number, to: number) => {
      for (let k = 0; k < 3; k++) {
        own[k] = Math.min(own[k], low[from + k])
        own[3 + k] = Math.max(own[3 + k], high[to + k])
      }
    }
    if (left[node] >= 0)
      for (const kid of [left[node], right[node]]) grow(boxes, boxes, 6 * kid, 6 * kid + 3)
    else
      for (let slot = first[node]; slot < first[node] + size[node]; slot++)
        for (let c = 0; c < 3; c++) grow(corners, corners, 9 * slot + 3 * c, 9 * slot + 3 * c)
  }
  for (let node = 0; node < count; node++)
    for (let k = 0; k < 3; k++) {
      boxes[6 * node + k] = f(boxes[6 * node + k] - slack)
      boxes[6 * node + 3 + k] = f(boxes[6 * node + 3 + k] + slack)
    }
  return boxes
}

/** The scene words about `origin`, for the voxels of `mips` along `directions` (three numbers each), and the doubt in the scene's units. */
function pack(scene: Scene, mips: readonly MipGrid[], directions: Float64Array, origin: Vec3) {
  const { tree } = scene
  const depth = depthOf(tree)
  if (depth > DISTANCE_FIELD_KERNEL_MAX_DEPTH)
    throw new VoxelKernelRefused(
      `a mesh's distance-field tree is ${depth} deep, past the walk's ${DISTANCE_FIELD_KERNEL_MAX_DEPTH}`,
    )
  const nodes = tree.left.length
  const triangles = tree.triangles.length / 9
  const rays = directions.length / 3
  const corners = Float32Array.from(tree.triangles, (v, k) => v - origin[k % 3])
  const volumes = mips.flatMap((mip) =>
    volumeOf(mip).flatMap((corner) => corner.map((v, k) => f(v - origin[k]))),
  )
  const largestCorner = corners.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
  const largest = volumes.reduce((m, x) => Math.max(m, Math.abs(x)), largestCorner)
  const doubt = f(DISTANCE_FIELD_KERNEL_DOUBT * largest)
  const headWords = DISTANCE_FIELD_KERNEL_HEAD_WORDS
  const volumeWords = 4 * DISTANCE_FIELD_KERNEL_MIP_RECORDS
  const mipsAt = headWords
  const raysAt = mipsAt + mips.length * volumeWords
  const nodesAt = raysAt + rays * 4
  const trianglesAt = nodesAt + nodes * 16
  const words = new Uint32Array(trianglesAt + triangles * 12)
  const floats = new Float32Array(words.buffer)
  // Each mip's volume: its low corner and the trace distance, then its high corner.
  mips.forEach((mip, k) => {
    const at = mipsAt + k * volumeWords
    floats.set(volumes.slice(6 * k, 6 * k + 3), at)
    floats[at + 3] = mip.traceDistance
    floats.set(volumes.slice(6 * k + 3, 6 * k + 6), at + 4)
  })
  for (let ray = 0; ray < rays; ray++)
    floats.set(directions.subarray(3 * ray, 3 * ray + 3), raysAt + 4 * ray)
  const boxes = packedBoxes(tree, corners, largestCorner)
  for (let node = 0; node < nodes; node++) {
    const at = nodesAt + 16 * node
    floats.set(boxes.subarray(6 * node, 6 * node + 3), at)
    floats.set(boxes.subarray(6 * node + 3, 6 * node + 6), at + 4)
    const leaf = tree.left[node] < 0
    words.set(leaf ? [] : [tree.left[node], tree.right[node]], at + 8)
    words.fill(DISTANCE_FIELD_KERNEL_NONE, at + 8 + (leaf ? 0 : 2), at + 12)
    if (leaf) words.set([tree.first[node], tree.size[node]], at + 12)
  }
  for (let slot = 0; slot < triangles; slot++)
    for (let c = 0; c < 3; c++) {
      const at = trianglesAt + 12 * slot + 4 * c
      floats.set(corners.subarray(9 * slot + 3 * c, 9 * slot + 3 * c + 3), at)
      words[at + 3] = c === 0 && scene.twoSided ? 1 : 0
    }
  words.set([nodesAt / 4, trianglesAt / 4, nodes, enoughBackFaces(rays)], 0)
  words.set([rays, raysAt / 4, mipsAt / 4], 4)
  floats[7] = doubt
  return { words, doubt }
}

/** What the kernel is sent and what its results are read by, as plain data a worker makes and the page's thread takes: the scene words,
 *  the doubt, the centre the points are taken about, the bricks to measure and the mips they lie in. */
export interface PreparedField {
  readonly words: Uint32Array<ArrayBuffer>
  readonly doubt: number
  readonly origin: Vec3
  readonly touched: readonly Touched[]
  readonly mips: readonly MipGrid[]
}

/** The scene of the voxels of the bricks `touched` of `mips` measured against `scene` along `directions`, packed about the centre of its
 *  box. A `VoxelKernelRefused` for a tree the walk would not hold or too many rays for a voxel's echo. */
export function prepareField(
  scene: Scene,
  mips: readonly MipGrid[],
  directions: Float64Array,
  touched: readonly Touched[],
): PreparedField {
  if (directions.length / 3 >= 1 << SHIFT)
    throw new VoxelKernelRefused(`${directions.length / 3} rays leave no room for a voxel's echo`)
  const origin = [0, 1, 2].map((k) => 0.5 * (scene.low[k] + scene.high[k])) as Vec3
  return { ...pack(scene, mips, directions, origin), origin, touched, mips }
}

/** The job `prepared` names: its points made on demand, a run at a time. */
export function voxelJobOf({ words, doubt, origin, touched, mips }: PreparedField): VoxelJob {
  // The brick the last voxel was in, and its frame: a batch may start or end mid-brick, and a brick's frame is made once.
  let held = -1
  let frame: Frame
  const position: Vec3 = [0, 0, 0]
  const point = new Float32Array(4)
  const pointOf = (at: number, into: Float32Array, k: number) => {
    const brick = Math.floor(at / BRICK_VOXELS)
    if (brick !== held) {
      const { mip, rank } = touched[brick]
      frame = frameOf(mips[mip], cellOf(rank, mips[mip].bricks))
      held = brick
    }
    voxelAt(frame, at % BRICK_VOXELS, position)
    for (let a = 0; a < 3; a++) into[k + a] = position[a] - origin[a]
    into[k + 3] = touched[brick].mip
  }
  return {
    words,
    doubt,
    mips,
    count: touched.length * BRICK_VOXELS,
    fill(first, count, items) {
      for (let voxel = 0; voxel < count; voxel++) pointOf(first + voxel, items, 4 * voxel)
    },
    echoOf(at) {
      pointOf(at, point, 0)
      return echoOfPoint(point)
    },
    mipOf: (at) => touched[Math.floor(at / BRICK_VOXELS)].mip,
  }
}

/** Whether `distance`, measured in single precision, lies within four doubts of a step of `mip`'s bytes — a distance's own rounding is a
 *  few of its coordinates' —: the byte the double distance gives may then be the next one. */
function nearAStep(mip: MipGrid, distance: number, doubt: number) {
  const scale = 2 * mip.band
  const byte = ((distance * mip.toVolume + mip.band) / scale) * 255 + 0.5
  const margin = ((4 * doubt * mip.toVolume) / scale) * 255
  return Math.abs(byte - Math.sign(byte) * Math.round(Math.abs(byte))) < margin
}

/** The bytes of `results`, the kernel's values for voxels `first` on, written to `voxels`, and the voxels to measure again added to
 *  `doubtful`: one the kernel marked doubtful, one it dropped (its value is still all ones: no number, `DOUBTFUL` set), one measured at
 *  another point or written at another's place (its echo is not the point's), one whose distance lies near a step of its byte. */
export function landVoxels(
  job: VoxelJob,
  first: number,
  results: Uint32Array,
  into: { voxels: Uint8Array; doubtful: Doubtful[] },
) {
  for (let k = 0; k < results.length / 2; k++) {
    const at = first + k
    const mip = job.mips[job.mipOf(at)]
    BITS[0] = results[2 * k]
    const distance = FLOATS[0]
    const second = results[2 * k + 1]
    const settled =
      (second & DOUBTFUL) === 0 &&
      Number.isFinite(distance) &&
      ((second >>> SHIFT) & ECHO_MASK) === job.echoOf(at)
    if (!settled || nearAStep(mip, distance, job.doubt))
      into.doubtful.push(settled ? { at, settled: distance } : { at })
    into.voxels[at] = quantise(mip, distance)
  }
}

/** The voxels the kernel measured: their bytes, and the ones to measure again. */
export interface Measured {
  readonly voxels: Uint8Array<ArrayBuffer>
  readonly doubtful: readonly Doubtful[]
}

/** `doubtful` as the two arrays a message carries (`doubtfulOf` reads them): the voxels' ranks, and the distance the GPU settled, NaN for none. */
export function doubtfulArrays(doubtful: readonly Doubtful[]) {
  return {
    at: Uint32Array.from(doubtful, (d) => d.at),
    settled: Float64Array.from(doubtful, (d) => d.settled ?? NaN),
  }
}

/** The voxels to measure again that `doubtfulArrays` made. */
export const doubtfulOf = (at: Uint32Array, settled: Float64Array): Doubtful[] =>
  Array.from(at, (rank, k) =>
    Number.isNaN(settled[k]) ? { at: rank } : { at: rank, settled: settled[k] },
  )

/** The `doubtful` voxels measured again on the CPU, in double precision, their bytes written over the GPU's in `voxels`. A voxel whose sign
 *  the GPU settled, its distance alone near a step of the bytes, needs the nearest triangle alone: its rays meet what they met on the GPU. */
export function remeasure(
  scene: Scene,
  mips: readonly MipGrid[],
  directions: Float64Array,
  touched: readonly Touched[],
  doubtful: readonly Doubtful[],
  voxels: Uint8Array,
) {
  const volumes = mips.map((mip) => Float64Array.from(volumeOf(mip).flat()))
  const position: Vec3 = [0, 0, 0]
  for (const { at, settled } of doubtful) {
    const { mip: rank, rank: cell } = touched[Math.floor(at / BRICK_VOXELS)]
    const grid = mips[rank]
    voxelAt(frameOf(grid, cellOf(cell, grid.bricks)), at % BRICK_VOXELS, position)
    const trace = grid.traceDistance
    let distance: number
    if (settled === undefined)
      distance = signedDistance(scene, position, trace, directions, volumes[rank])
    else if (Math.abs(settled) < trace) {
      const near = scene.nearest(position[0], position[1], position[2], trace)
      distance =
        near < 0
          ? trace
          : settled < 0 || Object.is(settled, -0)
            ? -Math.sqrt(near)
            : Math.sqrt(near)
    } else distance = trace
    voxels[at] = quantise(grid, distance)
  }
}
