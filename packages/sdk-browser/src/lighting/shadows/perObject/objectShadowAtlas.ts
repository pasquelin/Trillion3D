import { viewKey } from '../../../frame/backend/state/viewKey.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { ObjectShadowSubject } from './objectShadowSubjects.ts'
import { TRANSLUCENT_SHADOW_FORMAT, TRANSLUCENT_SHADOW_TARGETS } from './translucentShadowRules.ts'
import {
  packTranslucentShadows,
  sortByArea,
  type TranslucentShadowSlot,
} from './transmissionAtlas.ts'

/**
 * THE TRANSLUCENT SHADOW ATLASES OF A VIEW: the two float targets (`TRANSLUCENT_SHADOW_TARGETS`) of four 16-bit channels each, one pair a
 * packed atlas, that the subjects' Fourier coefficients are added into and the lights' shadow projection reads back. A view owns its
 * atlases (`viewKey`): made when a frame has a subject, grown or shrunk when the packing needs another count or side, retired (the
 * encoders still open may bind them) when the frame has none. A frame with no pair holds nothing.
 */

/** One atlas: its side, the first layer of its pair in the array texture, and the 2D views of its two layers (the render targets and the projection's reads). */
export interface TranslucentShadowAtlas {
  readonly side: number
  readonly layer: number
  readonly views: readonly GPUTextureView[]
}

/** What a frame's subjects were given: the atlases, and the slot of each subject (`slots[k]` for `subjects[k]`; `null` where none fits). `array` is the one 2D array view of every layer (atlas `i` at layers `2i`, `2i+1`), which the blends read their object's shadow from. */
export interface ObjectShadowAtlases {
  readonly atlases: readonly TranslucentShadowAtlas[]
  readonly slots: readonly (TranslucentShadowSlot | null)[]
  readonly texture: GPUTexture
  readonly array: GPUTextureView
}

interface Held {
  device: GPUDevice
  atlases: TranslucentShadowAtlas[]
  texture: GPUTexture
  array: GPUTextureView
}
const held = new WeakMap<object, Held>()
/** The packing order, reused. */
const order: {
  subject: ObjectShadowSubject
  index: number
  resolutionX: number
  resolutionY: number
}[] = []

/** One texture of `count` atlases, `TRANSLUCENT_SHADOW_TARGETS` layers each: a single sampled texture for the readers, one view a layer for the targets. */
function makeAtlases(device: GPUDevice, side: number, count: number): Held {
  const texture = device.createTexture({
    label: 'Trillion3D translucent object shadow',
    size: [side, side, count * TRANSLUCENT_SHADOW_TARGETS],
    format: TRANSLUCENT_SHADOW_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  })
  const atlases = Array.from({ length: count }, (_, index): TranslucentShadowAtlas => {
    const layer = index * TRANSLUCENT_SHADOW_TARGETS
    return {
      side,
      layer,
      views: Array.from({ length: TRANSLUCENT_SHADOW_TARGETS }, (_, target) =>
        texture.createView({
          dimension: '2d',
          baseArrayLayer: layer + target,
          arrayLayerCount: 1,
        }),
      ),
    }
  })
  return { device, atlases, texture, array: texture.createView({ dimension: '2d-array' }) }
}

/** Lets go of the view's atlases (a view leaving, or a frame with no subject). */
export function releaseObjectShadowAtlases(gpu: { viewKey?: object }) {
  const key = viewKey(gpu)
  const kept = held.get(key)
  if (!kept) return
  retire(kept.device, kept.texture)
  held.delete(key)
}

/**
 * The atlases for `subjects`, packed largest first into squares of `side` texels, each subject's slot beside. With no subject the view's
 * atlases are let go and nothing is made.
 */
export function objectShadowAtlasesOf(
  rt: Pick<WebgpuPagesRuntime, 'gpu'>,
  device: GPUDevice,
  subjects: readonly ObjectShadowSubject[],
  side: number,
): ObjectShadowAtlases | undefined {
  if (!subjects.length) {
    releaseObjectShadowAtlases(rt.gpu)
    return undefined
  }
  order.length = 0
  subjects.forEach((subject, index) =>
    order.push({
      subject,
      index,
      resolutionX: subject.projection.resolutionX,
      resolutionY: subject.projection.resolutionY,
    }),
  )
  sortByArea(order)
  const packed = packTranslucentShadows(order, side)
  const slots: (TranslucentShadowSlot | null)[] = new Array(subjects.length).fill(null)
  order.forEach((o, k) => (slots[o.index] = packed.slots[k]!))
  const key = viewKey(rt.gpu)
  let kept = held.get(key)
  if (
    kept?.device !== device ||
    kept.atlases.length !== packed.atlases ||
    kept.atlases.some((a) => a.side !== side)
  ) {
    if (kept) retire(kept.device, kept.texture)
    held.set(key, (kept = makeAtlases(device, side, packed.atlases)))
  }
  return { atlases: kept.atlases, slots, texture: kept.texture, array: kept.array }
}
