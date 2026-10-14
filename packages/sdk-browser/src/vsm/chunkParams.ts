/**
 * THE PARAMETERS OF A CHUNKED RASTER (`renderPass.ts`, the transmission's bin): the main view whose
 * detail the casters take, the map views, and each chunk's slot (`VsmRenderParams`), sent where
 * they changed alone.
 */
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import { grownLength, resized } from '../../../math/src/sequence/resized.ts'
import { COMPUTE, computeBufferEntry, computeUniformEntry } from '../gpu/core/computeBindings.ts'
import { writeChanged, writeChangedSlots } from '../gpu/core/writeChanged.ts'
import { uniformSlots, type UniformSlots } from '../residency/pools.ts'
import { VSM_MIPS } from './constants.ts'
import { VSM_RENDER_PARAMS, VSM_RENDER_VIEW_DIRECTIONAL } from './renderParamsWgsl.ts'
import type { VsmBoundLight } from './rowPageBound.ts'

/** The main view whose level of detail the casters take (the level of detail the main view
 *  draws). */
export interface VsmRenderCamera {
  /** World eye position (double precision; split high/low on upload). */
  eye: ArrayLike<number>
  /** World-to-view matrix, column-major, engine convention (−Z forward). */
  view: ArrayLike<number>
  /** Pixels per unit at unit depth (perspective) or per unit (ortho): max(P00·w/2, P11·h/2). */
  focalPixels: number
  near: number
  perspective: boolean
  /** The camera cut's pixel error threshold. */
  threshold: number
}

/** Declared: a caster whose radius is under a hundredth of its distance from the eye (0.57°, about
 *  5 pixels of radius in a 1 080-pixel, 90° view) is not drawn into an uncached map; squared, as
 *  the cull compares squares. Larger drops more small casters from fresh maps; 0 keeps them all. */
const VSM_SMALL_CASTER_SQ = 0.01 * 0.01

/** Bytes of the parameters a kernel binds from its chunk's slot (`VsmRenderParams`). */
export const VSM_RENDER_PARAMS_BYTES = VSM_RENDER_PARAMS.words * 4
/** The chunks' parameter slots on a device of `limits`, as many as a frame's chunks (`offset`
 *  makes each the first time it is asked): the raster's and the transmission's. */
export const vsmChunkParamSlots = (limits: Parameters<typeof uniformSlots>[0]) =>
  uniformSlots(limits, 0, VSM_RENDER_PARAMS.words, true)

/** The parameters' binding: the chunk's slot, by dynamic offset. */
export const vsmRenderParamsEntry = (binding: number) =>
  computeUniformEntry(binding, { hasDynamicOffset: true, minBindingSize: VSM_RENDER_PARAMS_BYTES })

/** Group 0 of a candidates kernel (`VSM_RENDER_ROWS_WGSL`): the parameters, the four row tables
 *  it reads, the candidates and the counters it writes — the raster's, and the transmission's
 *  with a binding of its own after them. */
export const vsmCandidatesEntries = () => [
  vsmRenderParamsEntry(0),
  ...[1, 2, 3, 4].map((b) => computeBufferEntry(b, 'read-only-storage', COMPUTE)),
  computeBufferEntry(5, 'storage', COMPUTE),
  computeBufferEntry(6, 'storage', COMPUTE),
]

/**
 * Map views, as `vec4u` (VSM id, mips, flags, 0): one per clipmap level (1
 * mip, clamp to near plane), one per local light face / map (8 mip views); and
 * the mip views they hold in all.
 */
export function vsmRenderViews(lights: readonly VsmBoundLight[], views: number[] = []) {
  views.length = 0
  let viewMips = 0
  for (const light of lights) {
    if (!light.shouldRender) continue
    const directional = light.kind === 'directional'
    for (let k = 0; k < light.count; k++) {
      const mips = directional ? 1 : VSM_MIPS
      views.push(light.firstId + k, mips, directional ? VSM_RENDER_VIEW_DIRECTIONAL : 0, 0)
      viewMips += mips
    }
  }
  return { views, viewMips }
}

/** What sizes the chunks of a raster over caster rows: `chunks` chunks of `chunkRows` rows over
 *  `rowCount` rows and `viewCount` views, each chunk's lists holding `cmds` commands and `pairs`
 *  pages. Decided by its pass (`renderPass.ts`, `transmissionBinPlan.ts`), handed to
 *  `vsmWriteChunkParams`. */
export interface VsmRenderChunking {
  rowCount: number
  viewCount: number
  chunks: number
  chunkRows: number
  cmds: number
  pairs: number
}

/** An image of parameter slots, its words seen as floats and as integers. */
interface VsmRenderParamsImage {
  f: Float32Array<ArrayBuffer>
  u: Uint32Array<ArrayBuffer>
}
const eye = new Float32Array(8)
/** The first words of the world-to-view rotation rows. */
const VIEW_ROWS = [
  VSM_RENDER_PARAMS.at.viewRow0,
  VSM_RENDER_PARAMS.at.viewRow1,
  VSM_RENDER_PARAMS.at.viewRow2,
]

/** The parameter slots of `chunking.chunks` chunks (`VsmRenderParams`), `slots` apart: the
 *  frame's values in every slot, the chunk's own index and range — into `image` (its words past the
 *  struct's left as they are: zero, as nothing else writes them). */
function vsmRenderParams(
  camera: VsmRenderCamera,
  chunking: VsmRenderChunking,
  image: VsmRenderParamsImage,
  slots: UniformSlots,
) {
  const { chunks, chunkRows } = chunking
  const slotWords = slots.strideWords
  const { f, u } = image
  const { at } = VSM_RENDER_PARAMS
  for (let a = 0; a < 3; a++) writeSplitDouble(eye, a, 4 + a, camera.eye[a])
  for (let c = 0; c < chunks; c++) {
    const o = c * slotWords
    for (let a = 0; a < 3; a++) {
      f[o + at.eyeHigh + a] = eye[a]
      f[o + at.eyeLow + a] = eye[4 + a]
    }
    f[o + at.perspective] = camera.perspective ? 1 : 0
    f[o + at.focal] = camera.focalPixels
    // World-to-view rotation rows (column-major m[c*4+r]).
    for (let r = 0; r < 3; r++) {
      const row = o + VIEW_ROWS[r]
      f[row] = camera.view[r]
      f[row + 1] = camera.view[4 + r]
      f[row + 2] = camera.view[8 + r]
      f[row + 3] = 0
    }
    f[o + at.near] = camera.near
    f[o + at.threshold] = camera.threshold
    f[o + at.smallCasterSq] = VSM_SMALL_CASTER_SQ
    u[o + at.rowCount] = chunking.rowCount
    u[o + at.viewCount] = chunking.viewCount
    u[o + at.chunk] = c
    u[o + at.chunkFirst] = c * chunkRows
    u[o + at.chunkRows] = chunkRows
    u[o + at.chunkCount] = chunks
    u[o + at.cmdCapacity] = chunking.cmds
    u[o + at.pairCapacity] = chunking.pairs
  }
}

// The frame's scratch of the raster and the transmission's draw (one after the other, never
// nested): their views and parameter slots, rewritten each frame (what reaches a buffer is what
// `writeChanged` holds for it, per buffer).
let viewWords = new Uint32Array(0)
const paramsImage: VsmRenderParamsImage = {
  f: new Float32Array(0),
  u: new Uint32Array(0),
}
/** The parameter slots of `chunking`, laid in `slots`, and the views `views` up to their
 *  buffers: each slot's words where they changed alone (`writeChangedSlots`). */
export function vsmWriteChunkParams(
  device: GPUDevice,
  camera: VsmRenderCamera,
  chunking: VsmRenderChunking,
  paramsBuffer: GPUBuffer,
  viewsBuffer: GPUBuffer,
  views: readonly number[],
  slots: UniformSlots,
) {
  const { chunks } = chunking
  vsmGrowParamsImage(paramsImage, chunks * slots.strideWords)
  vsmRenderParams(camera, chunking, paramsImage, slots)
  writeChangedSlots(device, paramsBuffer, paramsImage.u, slots, 0, chunks)
  viewWords = resized(viewWords, views.length)
  for (let k = 0; k < views.length; k++) viewWords[k] = views[k]
  writeChanged(device, viewsBuffer, viewWords, 0, views.length)
}

/** `image` grown to hold `slotWords` words, by the engine's one rule (`grownLength`). */
function vsmGrowParamsImage(image: VsmRenderParamsImage, slotWords: number) {
  if (image.u.length >= slotWords) return
  const raw = new ArrayBuffer(grownLength(image.u.length, slotWords) * 4)
  image.f = new Float32Array(raw)
  image.u = new Uint32Array(raw)
}
