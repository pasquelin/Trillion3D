/**
 * THE SHADOW RASTER'S PARAMETERS (`renderPass.ts`): what the casters take of the main view, the map
 * views, and each view pass's slot (`VsmRenderParams`), sent where they changed alone; the table of
 * the frame's lights; the candidates' bind group layouts.
 */
import { packDoubles, writeSplitDouble } from '../../../../../../math/src/float/splitDouble.ts'
import { grownLength } from '../../../../../../math/src/sequence/resized.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { writeChanged, writeChangedSlots } from '../../../../gpu/core/writeChanged.ts'
import { uniformSlots, type UniformSlots } from '../../../../session/memory/pools.ts'
import type { VsmBoundLight } from '../mapViews.ts'
import { VSM_RENDER_PARAMS } from './renderParamsWgsl.ts'
import type { VsmRenderScene } from './renderPass.ts'
import type { VsmViewPass } from './renderViewPasses.ts'

/** What the casters take of the main view: its eye and its rotation, for a sun's far-shadow test,
 *  the draw distances and the size of an object on it; and the error in a map's pixels a cluster
 *  drawn in it may show (`threshold`). */
export interface VsmRenderCamera {
  /** World eye position (double precision; split high/low on upload). */
  eye: ArrayLike<number>
  /** World-to-view matrix, column-major, engine convention (−Z forward): its third row is read. */
  view: ArrayLike<number>
  /** The cut's pixel error threshold scaled by the shadows' level-of-detail bias
   *  (`shadowGeometryLodBias`): each map view selects its clusters against it (`vsmRenderLodAt`). */
  threshold: number
}

/** Bytes of the parameters a kernel binds from its view pass's slot (`VsmRenderParams`). */
export const VSM_RENDER_PARAMS_BYTES = VSM_RENDER_PARAMS.words * 4
/** The view passes' parameter slots on a device of `limits`, as many as a frame's passes (`offset`
 *  makes each the first time it is asked). */
export const vsmRenderParamSlots = (limits: Parameters<typeof uniformSlots>[0]) =>
  uniformSlots(limits, 0, VSM_RENDER_PARAMS.words, true)

/** The dynamic offset of the parameters' first slot, held: a kernel that binds it every frame takes
 *  no new array. */
export const VSM_RENDER_FIRST_SLOT: readonly number[] = [0]

/** The parameters' binding: the view pass's slot, by dynamic offset. */
export const vsmRenderParamsEntry = (binding: number) =>
  computeUniformEntry(binding, { hasDynamicOffset: true, minBindingSize: VSM_RENDER_PARAMS_BYTES })

/** Group 0 of a candidates kernel (`VSM_RENDER_CASTERS_WGSL`): the parameters, the three tables it
 *  reads — the clusters' records, the placements' words and boxes —, the list of casters, the
 *  candidates and the counters it writes, and the clusters' edges. */
export const vsmCandidatesEntries = () => [
  vsmRenderParamsEntry(0),
  ...[1, 2, 3].map((b) => computeBufferEntry(b, 'read-only-storage', COMPUTE)),
  ...[4, 5, 6].map((b) => computeBufferEntry(b, 'storage', COMPUTE)),
  computeBufferEntry(7, 'read-only-storage', COMPUTE),
]

/** Group 0 of the casters' closing kernels (`vsmRenderCastersDoneWgsl`): the parameters, the list of
 *  casters, the counters and the stats. */
export const vsmCastersDoneEntries = () => [
  vsmRenderParamsEntry(0),
  ...[1, 2, 3].map((b) => computeBufferEntry(b, 'storage', COMPUTE)),
]

/** Group 1 of a candidates kernel (`VSM_RENDER_WORLD_WGSL`): the camera cut's cold words, its frame
 *  words, its clusters' hot records and its placements' worlds, record tables read as the cut reads
 *  them (`../../../../geometry/dag/shader/bindings.ts`), the words its `work` holds the main
 *  view's filter in, the previous poses, and the shadow views' descent's flags, which hold the pages
 *  it listed (`../traversal/`). */
export const vsmCandidatesWorldEntries = () => [
  computeTextureEntry(0, 'uint', '2d-array'),
  computeTextureEntry(1, 'uint', '2d-array'),
  computeBufferEntry(2, 'read-only-storage', COMPUTE),
  computeTextureEntry(3, 'uint', '2d-array'),
  computeTextureEntry(4, 'uint', '2d-array'),
  computeTextureEntry(5, 'uint', '2d-array'),
  computeTextureEntry(6, 'uint', '2d-array'),
]

/** What a frame's raster is laid out for: `casterCap` candidates, `lights` lights of the frame
 *  (`vsmWriteLights`), `recordCapacity` records a view pass holds, and its view passes
 *  (`renderViewPasses.ts`: the maps each lists, at most those the GPU then lists as having pages
 *  to draw). */
export interface VsmRenderLayout {
  casterCap: number
  /** The word of the shadow views' descent's flags its listed pages start at (`../traversal/`). */
  listedBase: number
  /** The views the shadow views' descent lists at most, a map and a mip of it (`../traversal/`). */
  viewCap: number
  lights: number
  recordCapacity: number
  passes: readonly Pick<VsmViewPass, 'first' | 'maps'>[]
}

/** What the parameters take of a raster's scene: its camera, its cut's world switch, which
 *  casters its suns' far-shadow test reaches, the draw distances its casters take and the size
 *  under which an uncached map leaves a caster out. */
type VsmParamsScene = Pick<
  VsmRenderScene,
  | 'camera'
  | 'world'
  | 'farMeshes'
  | 'farDrop'
  | 'drawDistance'
  | 'tessellation'
  | 'pageCount'
  | 'hardwareEdge'
  | 'pageCompute'
>

/** An image of parameter slots, its words seen as floats and as integers. */
interface VsmRenderParamsImage {
  f: Float32Array<ArrayBuffer>
  u: Uint32Array<ArrayBuffer>
}
const eye = new Float32Array(8)

/** The parameter slots of `frame`'s view passes (`VsmRenderParams`), `slots` apart: the frame's
 *  values in every slot — the scene's camera, where its cut's world links start, which casters its
 *  suns' far-shadow test reaches and the distance past which every view leaves a caster out —, and
 *  the maps of the slot's view pass — into `image` (its words past the struct's left as they are:
 *  zero, as nothing else writes them). */
function vsmRenderParams(
  {
    camera,
    world,
    farMeshes,
    farDrop,
    drawDistance,
    tessellation,
    pageCount,
    hardwareEdge,
    pageCompute,
  }: VsmParamsScene,
  frame: VsmRenderLayout,
  image: VsmRenderParamsImage,
  slots: UniformSlots,
) {
  const slotWords = slots.strideWords
  const { f, u } = image
  const { at } = VSM_RENDER_PARAMS
  for (let a = 0; a < 3; a++) writeSplitDouble(eye, a, 4 + a, camera.eye[a])
  frame.passes.forEach((pass, p) => {
    const o = p * slotWords
    for (let a = 0; a < 3; a++) {
      f[o + at.eyeHigh + a] = eye[a]
      f[o + at.eyeLow + a] = eye[4 + a]
    }
    // The world-to-view rotation's third row (column-major m[c*4+r]): the depth along the view.
    const row = o + at.viewRow2
    f[row] = camera.view[2]
    f[row + 1] = camera.view[6]
    f[row + 2] = camera.view[10]
    f[row + 3] = 0
    f[o + at.threshold] = camera.threshold
    u[o + at.casterCap] = frame.casterCap
    u[o + at.listedBase] = frame.listedBase
    u[o + at.viewCap] = frame.viewCap
    u[o + at.pageCount] = pageCount
    packDoubles(u, o + at.eye0, camera.eye, 0, 3)
    u[o + at.viewCount] = pass.maps
    u[o + at.viewFirst] = pass.first
    u[o + at.lightCount] = frame.lights
    u[o + at.recordCapacity] = frame.recordCapacity
    u[o + at.worldLinks] = world.links ?? 0
    u[o + at.farMeshes] = farMeshes ? 1 : 0
    f[o + at.farDrop] = farDrop ?? 0
    u[o + at.filterBase] = world.filter?.base ?? 0
    u[o + at.drawDistances] = drawDistance ? (drawDistance.instances ? 3 : 1) : 0
    f[o + at.viewDistanceScale] = drawDistance?.scale ?? 1
    u[o + at.tessellated] = tessellation?.kinds ?? 0
    // No software half without its page rows: every cluster the hardware raster's.
    f[o + at.hardwareEdge] = pageCompute ? (hardwareEdge ?? 0) : 0
  })
}

// The frame's scratch of the raster's parameters, rewritten each frame (what reaches a buffer is
// what `writeChanged` holds for it, per buffer).
const paramsImage: VsmRenderParamsImage = {
  f: new Float32Array(0),
  u: new Uint32Array(0),
}

/** The parameter slots of `frame` over `scene`, laid in `slots`, up to their buffer: each slot's
 *  words where they changed alone (`writeChangedSlots`). The views are the GPU's
 *  (`renderViewsWgsl.ts`). */
export function vsmWriteRenderParams(
  device: GPUDevice,
  scene: VsmParamsScene,
  frame: VsmRenderLayout,
  paramsBuffer: GPUBuffer,
  slots: UniformSlots,
) {
  const total = frame.passes.length
  const words = total * slots.strideWords
  if (paramsImage.u.length < words) {
    const raw = new ArrayBuffer(grownLength(paramsImage.u.length, words) * 4)
    paramsImage.f = new Float32Array(raw)
    paramsImage.u = new Uint32Array(raw)
  }
  vsmRenderParams(scene, frame, paramsImage, slots)
  writeChangedSlots(device, paramsBuffer, paramsImage.u, slots, 0, total)
}

/** The table of the frame's lights, rewritten by each frame. */
let lightImage = new Uint32Array(0)

/**
 * The frame's `lights` laid in `buffer` for the views' kernel (`renderViewsWgsl.ts`): a `vec4u` a
 * light — its first map's id, its map count, two pad words —, only the words that changed going up
 * (`writeChanged`): a still frame sends none.
 */
export function vsmWriteLights(
  device: GPUDevice,
  buffer: GPUBuffer,
  lights: readonly Pick<VsmBoundLight, 'firstId' | 'count'>[],
) {
  const words = lights.length * 4
  if (lightImage.length < words)
    lightImage = new Uint32Array(new ArrayBuffer(grownLength(lightImage.length, words) * 4))
  lights.forEach(({ firstId, count }, k) => {
    lightImage[4 * k] = firstId
    lightImage[4 * k + 1] = count
  })
  writeChanged(device, buffer, lightImage, 0, words)
}
