/**
 * THE PARAMETERS OF A CHUNKED RASTER (`../render/renderPass.ts`, the transmission's bin): the main view whose
 * detail the casters take, the map views, and each chunk's slot (`VsmRenderParams`), sent where
 * they changed alone.
 */
import { writeSplitDouble } from '../../../../../../math/src/float/splitDouble.ts'
import { grownLength } from '../../../../../../math/src/sequence/resized.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { writeChangedSlots } from '../../../../gpu/core/writeChanged.ts'
import { uniformSlots, type UniformSlots } from '../../../../session/memory/pools.ts'
import { VSM_RENDER_PARAMS } from '../render/renderParamsWgsl.ts'
import type { VsmRenderScene } from '../render/renderPass.ts'

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

/** Group 1 of a candidates kernel (`VSM_RENDER_WORLD_WGSL`): the camera cut's cold words and its
 *  frame words, record tables read as the cut reads them (`../../../../geometry/dag/shader/bindings.ts`). */
export const vsmCandidatesWorldEntries = () => [
  computeTextureEntry(0, 'uint', '2d-array'),
  computeTextureEntry(1, 'uint', '2d-array'),
]

/** What sizes the chunks of a raster over caster rows: `chunks` chunks of `chunkRows` rows over
 *  `rowCount` rows and at most `viewCount` views (the GPU lists those with pages to draw), each chunk's lists holding `cmds` commands and `pairs`
 *  pages. Decided by its pass (`../render/renderPass.ts`, `../transmission/transmissionBinPlan.ts`), handed to
 *  `vsmWriteChunkParams`. */
export interface VsmRenderChunking {
  rowCount: number
  viewCount: number
  chunks: number
  chunkRows: number
  cmds: number
  pairs: number
}

/** What the parameters take of a raster's scene: its camera, and its cut's world switch. */
type VsmParamsScene = Pick<VsmRenderScene, 'camera' | 'world'>

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
 *  frame's values in every slot — the scene's camera and where its cut's world links start —, the
 *  chunk's own index and range — into `image` (its words past the struct's left as they are: zero,
 *  as nothing else writes them). */
function vsmRenderParams(
  { camera, world }: VsmParamsScene,
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
    u[o + at.rowCount] = chunking.rowCount
    u[o + at.viewCount] = chunking.viewCount
    u[o + at.chunk] = c
    u[o + at.chunkFirst] = c * chunkRows
    u[o + at.chunkRows] = chunkRows
    u[o + at.chunkCount] = chunks
    u[o + at.cmdCapacity] = chunking.cmds
    u[o + at.pairCapacity] = chunking.pairs
    u[o + at.worldLinks] = world?.links ?? 0
  }
}

// The frame's scratch of the raster and the transmission's draw (one after the other, never
// nested): their parameter slots, rewritten each frame (what reaches a buffer is what
// `writeChanged` holds for it, per buffer).
const paramsImage: VsmRenderParamsImage = {
  f: new Float32Array(0),
  u: new Uint32Array(0),
}

/** The parameter slots of `chunking` over `scene`, laid in `slots`, up to their buffer: each slot's
 *  words where they changed alone (`writeChangedSlots`). The views are the GPU's
 *  (`../render/renderViewsWgsl.ts`). */
export function vsmWriteChunkParams(
  device: GPUDevice,
  scene: VsmParamsScene,
  chunking: VsmRenderChunking,
  paramsBuffer: GPUBuffer,
  slots: UniformSlots,
) {
  const { chunks } = chunking
  vsmGrowParamsImage(paramsImage, chunks * slots.strideWords)
  vsmRenderParams(scene, chunking, paramsImage, slots)
  writeChangedSlots(device, paramsBuffer, paramsImage.u, slots, 0, chunks)
}

/** `image` grown to hold `slotWords` words, by the engine's one rule (`grownLength`). */
function vsmGrowParamsImage(image: VsmRenderParamsImage, slotWords: number) {
  if (image.u.length >= slotWords) return
  const raw = new ArrayBuffer(grownLength(image.u.length, slotWords) * 4)
  image.f = new Float32Array(raw)
  image.u = new Uint32Array(raw)
}
