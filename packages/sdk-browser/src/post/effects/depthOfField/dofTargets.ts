import { retire } from '../../../gpu/core/frameRetire.ts'
import { sameBokeh, type BokehModel } from './bokehModel.ts'
import {
  bytesOf,
  imageOf,
  imagesIn,
  makeImages,
  makeLuts,
  makeSpriteBuffers,
  type DofImages,
  type Image,
  type LutImages,
  type SpriteBuffers,
} from './dofImages.ts'
import { COLOR_FORMAT } from './dofLayout.ts'
import type { DofPlan } from './dofPlan.ts'

/** What decides the images and buffers of a plan: the sizes, the layers gathered, what scatters. Two plans
 *  with the same key are drawn on the same resources. */
export function planKey(plan: DofPlan, extent: readonly number[]) {
  const layers = plan.convolutions.map(
    (c) => `${c.layer}${c.quality}${c.postfilter ? 'f' : ''}${c.scatter ? 's' : ''}`,
  )
  return [
    plan.full,
    extent,
    plan.gather,
    plan.buffer,
    plan.reduced,
    plan.divisor,
    plan.mips,
    plan.dilations.map((d) => `${d.mode}${d.radius}${d.multiplier}`),
    layers,
    Math.floor(plan.scatterGroups),
  ].join('|')
}

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
    /** Makes them for `plan` and `extent` where its key moved; whether it did. */
    ensure(plan: DofPlan, extent: readonly number[]) {
      const next = planKey(plan, extent)
      if (images && key === next) return false
      release()
      key = next
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
 * THE IMAGES, BUFFERS AND TABLES OF THE DEPTH OF FIELD, shared by every pass of a chain — they run one
 * after the other, each finished with them before the next begins:
 * - the images and buffers of a plan, made when the plan's key moves (`planKey`) — a resize, another
 *   ring count or divisor, another layer gathered —;
 * - the output images, as many as the chain's passes, at most two, which take turns: a pass reads the
 *   image the one before wrote;
 * - the bokeh tables (`tablesStale`; `tablesBuilt` once a frame encoded their passes).
 * `generation` counts the times what the groups name was made again.
 */
export function createDofTargets(device: GPUDevice) {
  const resources = planResources(device)
  const tables = tableResources(device)
  const outputs: Image[] = []
  let generation = 0
  const dropOutputs = () => {
    for (const { texture } of outputs) retire(device, texture)
    outputs.length = 0
  }
  return {
    get generation() {
      return generation
    },
    /** Makes what `plan` needs for an image in textures of `extent`: its images and buffers, and the
     *  tables where it takes the diaphragm's shape. */
    ensure(plan: DofPlan, extent: readonly number[]) {
      if (resources.ensure(plan, extent)) {
        dropOutputs()
        generation++
      }
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
    /** The `at`-th output image, at the size of the image, made at the first ask. */
    output(at: number, extent: readonly number[]) {
      return (outputs[at] ??= imageOf(device, `image ${at}`, extent, COLOR_FORMAT))
    },
    tablesStale: tables.stale,
    tablesBuilt: tables.built,
    /** Bytes of every image, buffer and table made. */
    get bytes() {
      return resources.bytes + bytesOf(outputs, []) + tables.bytes
    },
    /** Frees everything. */
    release() {
      resources.release()
      dropOutputs()
      tables.release()
      generation++
    },
  }
}

/** The targets of the depth of field (`createDofTargets`). */
export type DofTargets = ReturnType<typeof createDofTargets>
