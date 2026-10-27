// The hair strands' GPU work (`packages/sdk-browser/src/hair/`) run on a real device over a groom:
// the tangents the pass writes once, and the integer bounds and voxel sizes of the macro groups it
// reduces, read back and set against the same values computed here in doubles from the packed points.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { destroyRetired } from '../../../packages/sdk-browser/src/gpu/core/frameRetire.ts'
import { pipelinesSettled } from '../../../packages/sdk-browser/src/lighting/deferred/compileLedger.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { frameAround } from '../../../packages/math/src/vector/frame.ts'
import { HAIR_STRANDS_POINT_BYTES } from '../../../packages/sdk-core/src/contracts/hairStrandsAbi.ts'
import type { HairStrands } from '../../../packages/sdk-core/src/hair/hairStrandsFile.ts'
import { HAIR_AABB_PRECISION_SCALE } from '../../../packages/sdk-browser/src/hair/boundsWgsl.ts'
import {
  HAIR_BOUNDS_FLOATS,
  HAIR_MIN_VOXEL_SIZE,
} from '../../../packages/sdk-browser/src/hair/boundsPass.ts'
import { HAIR_TANGENT_BYTES } from '../../../packages/sdk-browser/src/hair/groupResources.ts'
import type { HairFrameInputs } from '../../../packages/sdk-browser/src/hair/inputs.ts'
import {
  createHairScene,
  encodeHairScene,
  planHairView,
} from '../../../packages/sdk-browser/src/hair/scene.ts'
import { createHairViewGpu } from '../../../packages/sdk-browser/src/hair/viewGpu.ts'
import { MAX_MACRO_GROUPS } from '../../../packages/sdk-browser/src/hair/macroGroups.ts'

/** The camera of the proof: at (0, 0.5, 3) looking down −z, a vertical field of 60 degrees, an image
 *  of 640 by 360. The strands sit about the point (0, 0.5, 0). */
const EYE = [0, 0.5, 3]
const WIDTH = 640
const HEIGHT = 360
const FOCAL = 1 / Math.tan(Math.PI / 6)
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const PROJECTION = [FOCAL / (WIDTH / HEIGHT), 0, 0, 0, 0, FOCAL, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0]
const SIZE_IN_PIXEL = 1
const PAGE_RESOLUTION = 32

/** The image's inputs: the camera above, with the planes of a view that leaves nothing out (the
 *  strands lie in front of the camera). */
const INPUTS: HairFrameInputs = {
  camera: {
    view: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -EYE[0]!, -EYE[1]!, -EYE[2]!, 1]),
    projection: Float64Array.from(PROJECTION),
    near: 0.1,
    eye: Float64Array.from(EYE),
    viewRelative: Float64Array.from(IDENTITY),
    planes: Float64Array.from([
      1, 0, 0, 1e9, -1, 0, 0, 1e9, 0, 1, 0, 1e9, 0, -1, 0, 1e9, 0, 0, 1, 1e9, 0, 0, -1, 1e9,
    ]),
    perspective: 1,
  },
  size: [WIDTH, HEIGHT],
  allocated: [WIDTH, HEIGHT],
  depthView: undefined,
  viewProjection: Float64Array.from(IDENTITY),
  inverseViewProjection: Float64Array.from(IDENTITY),
  forward: Float64Array.from([0, 0, -1]),
  pixelSize: [WIDTH, HEIGHT],
  sizeInPixel: SIZE_IN_PIXEL,
  pageResolution: PAGE_RESOLUTION,
  samplesPerPixel: 8,
  meanSamplesPerPixel: 0.75,
  rasterizationScale: 0.5,
  stableRasterizationScale: 1,
  flags: 0,
  sortByDepth: false,
  fullCoverage: 0.98,
  surfaces: undefined,
  emissionLayer: 0,
  shadow: undefined,
}

/** The tangent pair of every point of a group, in doubles, from the packed points: the unit
 *  direction through the point and the first axis of its frame (`frameAround`), `null` where a point
 *  has no neighbour on its strand (a strand of one point). */
function expectedTangents(points: Uint8Array) {
  const view = new DataView(points.buffer, points.byteOffset, points.byteLength)
  const count = points.byteLength / HAIR_STRANDS_POINT_BYTES
  const at = (i: number) => {
    const o = i * HAIR_STRANDS_POINT_BYTES
    return {
      p: [0, 1, 2].map((axis) => fromHalf(view.getUint16(o + axis * 2, true))),
      kind: view.getUint8(o + 7) >> 6,
    }
  }
  const unit = (a: number[], b: number[]) => {
    const d = a.map((v, k) => v - b[k]!)
    const l = Math.hypot(d[0]!, d[1]!, d[2]!)
    return d.map((v) => v / l)
  }
  return Array.from({ length: count }, (_, i) => {
    const here = at(i)
    let sum = [0, 0, 0]
    if (i > 0 && [0, 1].includes(at(i - 1).kind)) sum = unit(here.p, at(i - 1).p)
    if (i + 1 < count && [0, 2].includes(at(i + 1).kind))
      sum = sum.map((v, k) => v + unit(at(i + 1).p, here.p)[k]!)
    const l = Math.hypot(sum[0]!, sum[1]!, sum[2]!)
    if (!(l > 0)) return null
    const z = sum.map((v) => v / l) as [number, number, number]
    const frame = [0, 0, 0, 0, 0, 0]
    frameAround(frame, z[0], z[1], z[2])
    return { tangent: frame.slice(0, 3), axis: z }
  })
}

/** The bytes of a snorm8 word as signed values over 127. */
const snorm = (word: number) =>
  [0, 8, 16].map((shift) => Math.max(-1, ((((word >> shift) & 255) << 24) >> 24) / 127))

/** Runs the passes over `strands` and compares: returns the counts and the largest gaps. */
export async function runHairStrands(strands: HairStrands) {
  const gpu = await openGpuDevice()
  if (!gpu) return { unavailable: true as const }
  const { device } = gpu
  const scene = createHairScene(device, strands, true)
  const view = createHairViewGpu(device, scene, { ...INPUTS }, true)
  const encodeImage = (encoder: GPUCommandEncoder) => {
    const groups = planHairView(scene.instances, view.bounds.update, view.lists, view.inputs)
    encodeHairScene(device, encoder, scene, view.bounds)
    return groups
  }
  // The first image asks the programs; the frame that finds them compiled runs them.
  encodeImage(device.createCommandEncoder())
  await pipelinesSettled(device)
  const encoder = device.createCommandEncoder()
  const macroGroups = encodeImage(encoder)
  device.queue.submit([encoder.finish()])

  // The tangents: each point's pair within one step of a signed byte of the doubles'.
  let tangentGap = 0,
    tangentsCompared = 0
  for (const [k, { group }] of scene.instances.entries()) {
    const words = (await readGpuBuffer(
      device,
      group.tangents,
      group.pointCount * HAIR_TANGENT_BYTES,
    ))!
    expectedTangents(strands.groups[k]!.points).forEach((expected, i) => {
      if (!expected) return
      const read = [snorm(words[i * 2]!), snorm(words[i * 2 + 1]!)]
      const wanted = [expected.tangent, expected.axis]
      for (let pair = 0; pair < 2; pair++)
        for (let axis = 0; axis < 3; axis++)
          tangentGap = Math.max(
            tangentGap,
            Math.abs(read[pair]![axis]! - wanted[pair]![axis]!) * 127,
          )
      tangentsCompared++
    })
  }

  // The bounds: the macro groups' integers and voxel sizes against the doubles'.
  const { bounds } = view
  const { update } = bounds
  const macroAabb = new Int32Array(
    (await readGpuBuffer(device, bounds.macroAabb, MAX_MACRO_GROUPS * 6 * 4))!.buffer,
  )
  const voxelSizes = new Float32Array(
    (await readGpuBuffer(device, bounds.macroVoxelSize, MAX_MACRO_GROUPS * 4))!.buffer,
  )
  const instanceAabb = new Int32Array(
    (await readGpuBuffer(device, bounds.groupAabb, scene.instances.length * 6 * 4))!.buffer,
  )
  const boxes = update.bounds.f
  let boundGap = 0,
    sizeGap = 0,
    compared = 0
  const scale = HAIR_AABB_PRECISION_SCALE
  scene.instances.forEach((_, k) => {
    for (let axis = 0; axis < 3; axis++) {
      boundGap = Math.max(
        boundGap,
        Math.abs(
          instanceAabb[k * 6 + axis]! - Math.trunc(boxes[k * HAIR_BOUNDS_FLOATS + axis]! * scale),
        ),
        Math.abs(
          instanceAabb[k * 6 + 3 + axis]! -
            Math.trunc(boxes[k * HAIR_BOUNDS_FLOATS + 4 + axis]! * scale),
        ),
      )
    }
  })
  macroGroups.forEach((group, rank) => {
    const members = group.members.filter((one) => one.supportsVoxelization)
    if (!members.length) return
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity]
    for (const one of members) {
      const k = one.registeredIndex
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(
          lo[axis]!,
          Math.trunc(boxes[k * HAIR_BOUNDS_FLOATS + axis]! * scale) / scale,
        )
        hi[axis] = Math.max(
          hi[axis]!,
          Math.trunc(boxes[k * HAIR_BOUNDS_FLOATS + 4 + axis]! * scale) / scale,
        )
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      boundGap = Math.max(
        boundGap,
        Math.abs(macroAabb[rank * 6 + axis]! - Math.trunc(lo[axis]! * scale)),
        Math.abs(macroAabb[rank * 6 + 3 + axis]! - Math.trunc(hi[axis]! * scale)),
      )
    }
    // The voxel: a pixel's width at the nearest depth, raised so the group spans a page at least.
    const nearest = -hi[2]!
    const pixel = (1 / PROJECTION[5]! / (0.5 * HEIGHT)) * Math.max(nearest, 1e-5)
    let voxel = pixel * SIZE_IN_PIXEL
    const reach = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!)
    if (reach / voxel < PAGE_RESOLUTION) voxel = reach / PAGE_RESOLUTION
    voxel = Math.max(HAIR_MIN_VOXEL_SIZE, voxel)
    sizeGap = Math.max(sizeGap, Math.abs(voxelSizes[rank]! / voxel - 1))
    compared++
  })
  view.dispose()
  scene.dispose()
  destroyRetired(device)
  const { court } = await gpu.fermer()
  return {
    adapter: court,
    errors: gpu.errors,
    tangentsCompared,
    tangentGap,
    entryCount: update.entryCount,
    macroGroups: macroGroups.length,
    compared,
    boundGap,
    sizeGap,
  }
}
