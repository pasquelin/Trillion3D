import { retire } from '../../gpu/core/frameRetire.ts'
import { BEND_MAX_LAYERS } from './bendDispatches.ts'
import { BEND_OUTPUT_FORMAT } from './bendWgsl.ts'

/** The lanes of the ranks' uniform: `BEND_MAX_LAYERS` words, none marked by the rank no light has. */
const NO_RANK = 0xffffffff

/**
 * THE SCREEN-SPACE CONTACT SHADOWS OF AN IMAGE, one texture array of the image's size, a layer for each light that is marched (`BEND_MAX_LAYERS`
 * at most, the layers the lights marched in the order of `ranks`): each light's shadow, 1 where lit. The lit passes find a light's layer by its rank in the light buffer
 * (`contactBendWgsl`). Every layer is set to 1 before an image's marches, so a light that casts no march of its own, or whose march has not
 * run, leaves its pixels lit.
 */
export interface BendTarget {
  readonly texture: GPUTexture
  /** The whole array, which the lit passes read. */
  readonly array: GPUTextureView
  /** The ranks in the light buffer of the lights that have a layer, in the order of the layers: a uniform of `BEND_MAX_LAYERS` words. */
  readonly ranks: GPUBuffer
  /** Each layer as a 2D view, which a march writes and a clear sets. */
  readonly layers: readonly GPUTextureView[]
  readonly width: number
  readonly height: number
}

/** What each runtime keeps: its array, none while no image has marched. */
const held = new WeakMap<object, BendTarget>()

/** What the lit passes read of the last image's marches (`DirectLightResources.contactBend`): the array and the ranks of its layers. */
export interface ContactBendResources {
  readonly view: GPUTextureView
  readonly ranks: GPUBuffer
}

/** The resources the last image marched, none while it marched none. */
export const bendResourcesOf = (rt: object): ContactBendResources | undefined => {
  const target = held.get(rt)
  return target && { view: target.array, ranks: target.ranks }
}

/** The array of `rt` for an image of `width` × `height` pixels and `layers` marched lights: the one it holds, or made now. */
export function bendTargetFor(
  rt: object,
  device: GPUDevice,
  width: number,
  height: number,
  layers: number,
) {
  const current = held.get(rt)
  if (
    current &&
    current.width === width &&
    current.height === height &&
    current.layers.length >= layers
  )
    return current
  if (current) dropBendTarget(rt, device)
  const count = Math.max(layers, current?.layers.length ?? 0)
  const texture = device.createTexture({
    label: 'Trillion3D contact shadow march',
    size: [width, height, count],
    format: BEND_OUTPUT_FORMAT,
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const ranks = device.createBuffer({
    label: 'Trillion3D contact shadow march ranks',
    size: BEND_MAX_LAYERS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const target: BendTarget = {
    texture,
    ranks,
    array: texture.createView({ dimension: '2d-array' }),
    layers: Array.from({ length: count }, (_, layer) =>
      texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
    ),
    width,
    height,
  }
  held.set(rt, target)
  return target
}

/** The array given up, for an image that marches none. */
export function dropBendTarget(rt: object, device: GPUDevice) {
  const target = held.get(rt)
  if (!target) return
  held.delete(rt)
  retire(device, {
    destroy() {
      target.texture.destroy()
      target.ranks.destroy()
    },
  })
}

/** The ranks of the lights `target`'s layers hold, in the order of the layers, written for the lit passes. */
export function writeBendRanks(device: GPUDevice, target: BendTarget, ranks: readonly number[]) {
  const words = new Uint32Array(BEND_MAX_LAYERS).fill(NO_RANK)
  words.set(ranks.slice(0, BEND_MAX_LAYERS))
  device.queue.writeBuffer(target.ranks, 0, words)
}

/** Every layer of `target` set to 1 (lit), in `encoder`. */
export function clearBendTarget(encoder: GPUCommandEncoder, target: BendTarget) {
  for (const view of target.layers)
    encoder
      .beginRenderPass({
        label: 'Trillion3D contact shadow march clear',
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 0] }],
      })
      .end()
}
