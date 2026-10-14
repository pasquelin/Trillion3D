import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { BOX, RECT_BYTES } from './frontDepthWgsl.ts'
import { FRONT_FORMAT, FRONT_LABEL } from './frontTarget.ts'

/**
 * THE TRANSPARENTS' FRONT DEPTH: what lets the one reflection chain meet a blended surface. A ray
 * marches the depth pyramid, which holds the opaque surfaces; the nearest transparent surface of a
 * pixel joins that depth (the front layer of the Hi-Z's level 0, `GpuHiz.front`, which this
 * module writes and the nearest build folds in, `hizFrontAt`), so that the same march, the same
 * pyramid and the same radiance — the lit image with its transparents, which the radiance pyramid
 * already reads — answer a pane as they answer a wall. No second pass, march or pyramid.
 *
 * A transparent surface writes it as one more colour target (`TRANSPARENT_FRONT`), `FRONT_FORMAT`:
 * a fragment that covers its pixel (`REFLECTION_FRONT_COVERAGE`) writes its depth, the target's
 * `max` blend keeps the nearest whatever the order of the draws. A target write is no memory write
 * of the fragment stage: the early rejection of hidden blends stays (`earlyRejection.test.ts`). The
 * depth is written a half-float's step behind the surface, never in front of it, so that a ray
 * leaving the surface cannot meet its own pixel's depth.
 *
 * The depth of an image is not known before its blends are drawn, which come after the reflections
 * that read it: the image reads the last one's, carried to its own pixels (`frontScatter`) — each
 * texel of the rectangle the last image's transparents wrote unprojected through the last
 * view-projection and projected through this one's, one thread a pixel, an atomic only where a
 * surface was written — into a buffer, the box of the pixels it reached kept with it, one atomic a
 * workgroup. The box of this image and that of the last one (`frontBox`) bound what the front layer
 * the readers bind changes by: over them alone, each word is moved into the layer and the buffer
 * left at zero for the next image (`frontFold`, dispatched from the box on the GPU). Outside, the
 * layer already holds the zero the last image left there. For a still view that is the identity.
 * This module and its carrying (`frontCarry.ts`) own all of it but the layer, the Hi-Z's, which
 * the readers bind with the opaque depth in one texture: the target, the buffer, the boxes, and
 * whether the scene has blends at all.
 *
 * Why a buffer AND a texture: the scatter's nearest is an atomic `max`, which WebGPU offers on a
 * buffer only; the readers include the blend and water fragment stages, which bind WebGPU's
 * guaranteed 8 storage buffers already (`stageLimits.test.ts`), so they read a texture. A scatter
 * drawn as points into a depth target instead would clamp a depth past the near plane to 1: not the
 * same bits.
 *
 * Cost, for N pixels: with no transparent in view, nothing — no scatter, no fold, the layer is
 * zero and the nearest depth ignores it (`max`): the opaque image keeps its bits. With
 * transparents: the target's 2N bytes written by the blends, the scatter's read of 2 bytes a pixel
 * of the written rectangle and one atomic per surface pixel, the fold's 12 bytes a pixel of the two
 * boxes (a word read and reset, a texel written) — the transparents' own pixels for a still view,
 * never the screen's —, then the nearest build's and the march's reads of 4N bytes — against the
 * radiance pyramid's 8N bytes written. Floor: the blends' own fill, which the target adds 2 bytes a fragment
 * to. A scene with no blend holds a texel of the target and nothing else: the front layer stays
 * zero, whose fold is the opaque depth, bit for bit.
 */
/** Bytes of the fold's indirect arguments: its workgroups along x and y, then 1. */
const ARGS_BYTES = 12
/** Words of a row of the buffer the scatter writes: `width` words, the fold reading it word for
 *  texel. */
export const frontPitch = (width: number) => width

/** What the front depth of a view at `width × height` allocates: the target the transparents write,
 *  and, when the scene has `blends`, the scatter's buffer and uniform and the texture the readers
 *  bind; without, a texel of the target alone. The one source of `createFrontDepth` and
 *  `frontBytes`. */
function frontDescriptors(width: number, height: number, blends: boolean) {
  const size: GPUExtent3D = blends ? [width, height] : [1, 1]
  const written: GPUTextureDescriptor = {
    label: FRONT_LABEL,
    size,
    format: FRONT_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  }
  if (!blends) return { written }
  const carried = {
    buffer: {
      label: FRONT_LABEL,
      size: frontPitch(width) * height * 4,
      usage: GPUBufferUsage.STORAGE,
    },
    box: {
      label: FRONT_LABEL,
      size: BOX.words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    },
    args: {
      label: FRONT_LABEL,
      size: ARGS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    },
    rect: {
      label: FRONT_LABEL,
      size: RECT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    },
    // The rectangle and the scatter's workgroups of an image whose only transparent pass was the
    // water's: copied from the GPU's water rectangle (`frontFromWater`).
    waterRect: {
      label: FRONT_LABEL,
      size: RECT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    },
    waterArgs: {
      label: FRONT_LABEL,
      size: ARGS_BYTES,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    },
  } satisfies Record<string, GPUBufferDescriptor>
  return { written, carried }
}

/** Bytes of the front depth of a view at `width × height` (`frontDescriptors`). */
export function frontBytes(width: number, height: number, blends: boolean) {
  const { written, carried } = frontDescriptors(width, height, blends)
  return (
    textureBytesOf(written)! +
    (carried
      ? carried.buffer.size +
        carried.rect.size +
        carried.waterRect.size +
        carried.waterArgs.size +
        carried.box.size +
        carried.args.size
      : 0)
  )
}

/** The boxes as a view's front depth starts them: this image's and the last one's empty. */
const EMPTY_BOXES = Uint32Array.of(~0 >>> 0, ~0 >>> 0, 0, 0, ~0 >>> 0, ~0 >>> 0, 0, 0, 0, 0, 0, 0)

/**
 * What a view keeps of the front depth: the target the transparents write and its one attachment,
 * whether they wrote it since it was last carried (`fresh`) and the rectangle they wrote, and — when
 * the scene has `blends`, laid once when the session opens — what carries it: the buffer the
 * scatter folds into, whether the layer the readers bind holds a depth to clear (`held`), the
 * scatter's rectangle and its bind group. A scene with no blend draws no
 * transparent pass, carries nothing and clears nothing: the target is a texel, and nothing else is
 * made.
 */
export function createFrontDepth(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  const descriptors = frontDescriptors(width, height, blends)
  const written = device.createTexture(descriptors.written)
  const carried = descriptors.carried && {
    buffer: device.createBuffer(descriptors.carried.buffer),
    rect: device.createBuffer(descriptors.carried.rect),
    waterRect: device.createBuffer(descriptors.carried.waterRect),
    waterArgs: device.createBuffer(descriptors.carried.waterArgs),
    box: device.createBuffer(descriptors.carried.box),
    args: device.createBuffer(descriptors.carried.args),
  }
  // Both boxes start empty: no image reached a pixel yet.
  if (carried) device.queue.writeBuffer(carried.box, 0, EMPTY_BOXES)
  const view = written.createView()
  /** The attachment every transparent pass takes, made once (`frontAttachment`). */
  const attachment: GPURenderPassColorAttachment = {
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
  return {
    /** Whether it holds the full target: the scene had a blend when it was made. */
    wanted: blends,
    written,
    view,
    attachment,
    /** The rectangle the transparents wrote since the target was cleared: `[x0, y0, x1, y1]`. */
    rect: [0, 0, 0, 0],
    /** The rectangle the scatter's uniform is given (`writeChanged`). */
    scattered: new Uint32Array(4),
    carried,
    /** The front layer it last folded into (`GpuHiz.front`): another is cleared first. */
    target: undefined as GPUTextureView | undefined,
    fresh: false,
    held: false,
    /** The water pass is the only transparent pass that wrote since the target was cleared: its
     *  rectangle is the GPU's (`frontFromWater`). */
    water: false,
    /** The scatter's and the fold's group, the scatter's over the water's rectangle, and the
     *  boxes', under the identity of what they name (`createWebgpuBindIdentity`). */
    groups: {
      identity: createWebgpuBindIdentity(),
      group: undefined as GPUBindGroup | undefined,
      waterGroup: undefined as GPUBindGroup | undefined,
      boxGroup: undefined as GPUBindGroup | undefined,
    },
    dispose() {
      written.destroy()
      carried?.buffer.destroy()
      carried?.rect.destroy()
      carried?.waterRect.destroy()
      carried?.waterArgs.destroy()
      carried?.box.destroy()
      carried?.args.destroy()
    },
  }
}
export type FrontDepth = ReturnType<typeof createFrontDepth>
