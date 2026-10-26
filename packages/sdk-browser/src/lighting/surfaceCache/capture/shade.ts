import { SHADE_UNIFORM } from '../../../visibility/shader/uniformLayout.ts'
import { SHADE_UNIFORM_BYTES } from '../../../visibility/shader/request.ts'
import { createShadeBins, type ShadeBins } from '../../../materials/classes/shadeBins.ts'
import { createSurfaceBuffer } from '../../../materials/surface/surfaceAllocation.ts'
import {
  SURFACE_BYTES_PER_PIXEL,
  type SurfaceBuffer,
} from '../../../materials/surface/surfaceBuffer.ts'
import { SUBSURFACE_TARGET } from '../../../materials/surface/subsurface.ts'
import { shadeBindEntries, type ShadeBindResources } from '../../../gpu/bind/bindEntries.ts'
import { createWebgpuBindIdentity, entriesReady } from '../../../gpu/bind/bindIdentity.ts'
import { liveResources } from '../../../gpu/bind/liveEntries.ts'
import { shadeResources } from '../../../gpu/bind/shadeBindings.ts'
import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { presentClassKeys } from '../../../gpu/core/presentClasses.ts'
import { chainReady } from '../../deferred/fullscreen.ts'
import type { ShadeClasses } from '../../../visibility/passes/shadePipelines.ts'
import type { CardImage } from './raster.ts'

/**
 * THE SHADING OF A CAPTURE: the engine's material classes shade the surfaces a card raster drew
 * (`raster.ts`) as they shade the image's — one compute stage a class over the texels of its bin —,
 * into surfaces of the capture atlas's size: the base colour and metalness, the normal and
 * roughness, the emission, the thin sheets' transmission colour. What the classes need beside is the capture's own, a second set of what
 * the image's shading holds: its identifiers (`ids`) in the place of the image's visibility buffer, its
 * page table, its view as the resolve's uniform and its bins. The geometry, the
 * materials, the textures and the graphs are the scene's, bound as the image's own group binds them.
 *
 * The capture's classes write the emission layer whether the image's do or not (`cards`):
 * a card keeps the emission of its surface. The texture feedback is not written: a capture asks
 * for no texture a view would not. The shading places a texel on its triangle by the view of its row
 * (`CARD_VIEWS`, `../../../visibility/shader/pixelTriangleWgsl.ts`): the records of the views are
 * in the rows of the identifier texture past the image (`cardRasterWgsl.ts`), so the pages of every
 * view of the image are shaded in one go.
 */

/** The group 0 of the classes over an image's identifiers and rows, made again when what it binds moved. */
function createShadeGroup(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  uniform: GPUBuffer,
  surfaces: SurfaceBuffer,
) {
  const current: { ids?: GPUTextureView; rows?: GPUBuffer } = {}
  const base = shadeResources(rt)
  const resources = liveResources<ShadeBindResources>({
    visView: () => current.ids,
    cache: () => base.cache,
    position: () => base.position,
    uv: () => base.uv,
    normal: () => base.normal,
    pageTable: () => current.rows,
    textures: () => base.textures,
    sampler: () => base.sampler,
    uniform: () => uniform,
    material: () => base.material,
    lobes: () => surfaces.lobesView,
    voxelSteps: () => base.voxelSteps,
    frame: () => base.frame,
  })
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (image: CardImage, ids: GPUTextureView) => {
    current.ids = ids
    current.rows = image.rows
    const layout = rt.vis.shadeBindGroupLayout
    if (!layout) return undefined
    const entries = (identity.entries[0] ??= shadeBindEntries(resources))
    if (identity.entriesMoved(layout)) group = undefined
    if (!group && entriesReady(entries)) group = device.createBindGroup({ layout, entries })
    return group
  }
}

/** The resolve's uniform for `image` into `words`: the image's own words, the page count its, and a
 *  capture of cards: each row is placed by its own view, on the atlas's side. */
function writeUniform(
  rt: WebgpuPagesRuntime,
  words: Float32Array,
  ints: Uint32Array,
  image: CardImage,
  side: number,
) {
  const at = SHADE_UNIFORM.at
  words.set(rt.vis.shadeUniPacked)
  words[at.viewport] = words[at.viewport + 1] = side
  words[at.pixelRatio] = 1
  words[at.mipBias] = 0
  ints[at.pageCount] = image.rowCount
  ints[at.mode] = 0
  ints[at.feedback] = 0
}

/** The uniform buffer of the resolve. */
const createResolveUniform = (device: GPUDevice) =>
  device.createBuffer({
    label: 'Trillion3D card capture resolve uniform',
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

/** Whether the classes `keys` of `classes` are all compiled, each missing one asked now. */
function classesReady(classes: ShadeClasses, keys: readonly number[]) {
  let ready = true
  for (const key of keys) ready = chainReady(classes.of(key)) && ready
  return ready
}

/** Each class of `classes` over `keys` shaded over its bin of `bins`, in `pass`. */
function dispatchClasses(
  pass: GPUComputePassEncoder,
  classes: ShadeClasses,
  bins: ShadeBins,
  keys: CardImage['classKeys'],
) {
  keys.forEach((key, at) => {
    pass.setPipeline(classes.of(key).get()!)
    bins.dispatch(pass, at)
  })
}

/** The capture's shading, made for a capture atlas of `side` texels. */
export function createCardShading(rt: WebgpuPagesRuntime, device: GPUDevice, side: number) {
  let bins: ShadeBins | undefined
  let failure: unknown
  const surfaces: SurfaceBuffer = createSurfaceBuffer(device, side, side, {
    emissiveAo: true,
    subsurface: true,
  })
  const uniform = createResolveUniform(device)
  const words = new Float32Array(SHADE_UNIFORM.words)
  const ints = new Uint32Array(words.buffer)
  const groupOf = createShadeGroup(rt, device, uniform, surfaces)
  // The bins compile off the frame: the capture shades once they are ready.
  void createShadeBins(device).then(
    (made) => void (bins = made),
    (error: unknown) => void (failure = error),
  )
  return {
    /** The bytes the surfaces hold: what the budget is asked for beside the atlases. */
    bytes: surfaces.allocationBytes,
    /** The surfaces the classes write, which the resolve reads. */
    surfaces,
    /** Whether the capture can be shaded now: its bins are compiled and so are its classes of the present materials. */
    get ready() {
      const classes = rt.vis.shadeClasses
      return (
        !!bins &&
        !!classes &&
        !!rt.vis.shadeBindGroupLayout &&
        classesReady(classes.cards(), presentClassKeys(rt.vis.presentClasses))
      )
    },
    /** What stopped the bins from being made, none while they are or are being. */
    get failure() {
      return failure
    },
    /**
     * Shades the texels of `image`, drawn into `ids` — the surfaces written where `ids` is not 0 —, as
     * dispatches of `open`: the bins of its classes, each class over its bin. False when the capture
     * cannot be shaded yet.
     */
    shade(open: OpenPass, image: CardImage, ids: GPUTextureView) {
      const own = bins
      if (!own || !rt.vis.shadeClasses) return false
      const g = groupOf(image, ids)
      if (!g || !image.classKeys.length) return false
      // The classes of the capture compile off the frame: a class missing holds the whole shade back.
      const classes = rt.vis.shadeClasses.cards()
      if (!classesReady(classes, image.classKeys)) return false
      writeUniform(rt, words, ints, image, side)
      device.queue.writeBuffer(uniform, 0, words)
      own.assign(image.classKeys, false)
      own.layFor(side, side)
      own.encodeFromIds(open, ids, image.rows, uniform, side, side)
      const pass = open.pass
      pass.setBindGroup(0, g)
      pass.setBindGroup(1, own.outputs(surfaces, undefined))
      dispatchClasses(pass, classes, own, image.classKeys)
      return true
    },
    dispose() {
      surfaces.dispose()
      retire(device, { destroy: () => uniform.destroy() })
      bins?.dispose()
    },
  }
}

/** The capture's shading (`createCardShading`). */
export type CardShading = ReturnType<typeof createCardShading>

/** The bytes the surfaces of a capture atlas of `side` texels hold, before they are made: what the
 *  budget is asked for beside the atlases. */
export const cardShadingBytes = (side: number) =>
  side * side * SURFACE_BYTES_PER_PIXEL + SUBSURFACE_TARGET.bytes(side, side, true)
