import { retire } from '../../../gpu/core/frameRetire.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { sizedImage } from '../../filters/sizedImage.ts'
import { sameBokeh, type BokehModel } from './bokehModel.ts'
import {
  bytesOf,
  imagesIn,
  makeImages,
  makeLuts,
  makeSpriteBuffers,
  type DofImages,
  type LutImages,
  type SpriteBuffers,
} from './dofImages.ts'
import { COLOR_FORMAT } from './dofLayout.ts'
import type { DofPlan } from './dofPlan.ts'

/** The images and buffers of a plan, made when its key moves; the replaced ones are retired, destroyed
 *  once the frame that may name them is submitted. */
function planResources(device: GPUDevice) {
  let key = '',
    images: DofImages | undefined,
    buffers: SpriteBuffers | undefined
  const release = () => {
    if (images) for (const { texture } of imagesIn(images)) retire(device, texture)
    if (buffers) for (const buffer of Object.values(buffers)) retire(device, buffer)
    images = buffers = undefined
    key = ''
  }
  return {
    /** Makes them for `plan` where its key moved; whether it did. */
    ensure(plan: DofPlan) {
      if (images && key === plan.key) return false
      release()
      key = plan.key
      images = makeImages(device, plan)
      buffers = makeSpriteBuffers(device, plan)
      return true
    },
    get images() {
      return images!
    },
    get buffers() {
      return buffers!
    },
    get bytes() {
      return images ? bytesOf(imagesIn(images), Object.values(buffers!)) : 0
    },
    release,
  }
}

/** The bokeh tables, made when a plan first needs one and filled when the bokeh model they are built
 *  from moves. */
function tableResources(device: GPUDevice) {
  let luts: LutImages | undefined, built: BokehModel | undefined
  const release = () => {
    if (luts) for (const { texture } of Object.values(luts)) retire(device, texture)
    luts = built = undefined
  }
  return {
    /** Makes the tables where `needed` and drops them where not; whether that changed. */
    ensure(needed: boolean) {
      if (needed === !!luts) return false
      if (needed) luts = makeLuts(device)
      else release()
      return true
    },
    get luts() {
      return luts
    },
    /** Whether the tables are to be built: they exist and are not built for this bokeh model. */
    stale: (bokeh: BokehModel) => !!luts && !(built && sameBokeh(built, bokeh)),
    /** The tables were encoded for `bokeh`. */
    built(bokeh: BokehModel) {
      built = bokeh
    },
    get bytes() {
      return luts ? bytesOf(Object.values(luts), []) : 0
    },
    release,
  }
}

/**
 * THE IMAGES, BUFFERS AND TABLES OF ONE DEPTH OF FIELD of a chain — each its own, so that two with another
 * plan do not remake them by turns:
 * - the images and buffers of a plan, made when the plan's key moves (`DofPlan.key`) — a resize, another
 *   ring count or divisor, another layer gathered —;
 * - the bokeh tables (`tablesStale`; `tablesBuilt` once a frame encoded their passes).
 * `generation` counts the times what the groups name was made again.
 */
export function createDofTargets(device: GPUDevice) {
  const resources = planResources(device)
  const tables = tableResources(device)
  let generation = 0
  return {
    get generation() {
      return generation
    },
    /** Makes what `plan` needs: its images and buffers, and the tables where it takes the diaphragm's
     *  shape. */
    ensure(plan: DofPlan) {
      if (resources.ensure(plan)) generation++
      if (tables.ensure(plan.gatherLut || plan.scatterLut || plan.recombineLut)) generation++
    },
    get images() {
      return resources.images
    },
    get buffers() {
      return resources.buffers
    },
    get luts() {
      return tables.luts
    },
    tablesStale: tables.stale,
    tablesBuilt: tables.built,
    /** Bytes of every image, buffer and table made. */
    get bytes() {
      return resources.bytes + tables.bytes
    },
    /** Frees everything. */
    release() {
      resources.release()
      tables.release()
      generation++
    },
  }
}

/** The targets of one depth of field (`createDofTargets`). */
export type DofTargets = ReturnType<typeof createDofTargets>

/** The output images, two at most, which the depths of field of a chain share and take turns in: a pass
 *  reads the image the one before wrote, each made at the images' extent. The translucency is
 *  composed onto the last one, drawn over it (`../../../blend/translucency.ts`). */
export function createDofOutputs(device: GPUDevice) {
  const outputs = [0, 1].map((at) =>
    sizedImage(
      device,
      `${DEPTH_OF_FIELD_PASS} image ${at}`,
      COLOR_FORMAT,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    ),
  )
  return {
    /** The view of the `at`-th, in textures of `extent`, made at the first ask and again where the extent
     *  moved. */
    view: (at: number, extent: readonly number[]) => outputs[at].view(extent[0], extent[1]),
    get bytes() {
      return outputs.reduce((sum, held) => sum + held.bytes, 0)
    },
    release() {
      for (const held of outputs) held.release()
    },
  }
}
