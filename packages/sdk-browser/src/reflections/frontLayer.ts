import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { SURFACE_FORMATS } from '../scene/surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT } from '../scene/physicalLobes.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { TRANSPARENT_FRONT_PASS } from '../stage/passLabels.ts'

/**
 * THE TRANSPARENTS' FRONT LAYER: what lets the one reflection trace (`trace.ts`) answer a blended
 * surface as it answers an opaque one, within the same frame budget, with no ray of its own in a
 * fragment. Each pixel has two surfaces a reflection is traced for: the opaque one, and the nearest
 * transparent one that reflects — its front layer. The front pass (`../webgpu/blend/frontPass.ts`) draws every
 * transparent run once more, before the trace, its fragment writing no colour but the surface the
 * trace reads (`../webgpu/blend/frontStageWgsl.ts`): its normal and roughness, its surface flags and its lobes, as the
 * surface buffer holds the opaque one's, its depth tested and written over a copy of the opaque
 * depth, so that the nearest one is kept. The trace lists each tile once for each of its pixels'
 * surfaces that reflect, in the one list its budget walks from its rotating offset, and answers the front
 * surface as the opaque one: its proxy's ray cast within the one `FRAME_WORK`, kept in the one store, the
 * front's cells past the opaque's (`rtLayer`), under the same epoch's stamp, its last answer read where the
 * budget leaves it out (`bounce/runtimeAnswerWgsl.ts`); it writes the front's radiance here (`traced`): the
 * base lobe's and the coat's, each on a shared exponent, the depth it was traced at and the stamp of
 * the image that drew it (`frontStamp`).
 *
 * A forward fragment (`forwardReflectionWgsl`) whose depth is that front depth, in this image,
 * reads its reflection there: one load. Any other — a surface behind the front one, a fragment of an
 * image that drew no front pass — reads the chain without the proxy: the screen, the probes and the
 * environment.
 *
 * Cost, for N pixels of the view, F transparent fragments drawn and T front pixels: the front pass's
 * F surface fragments (the material's reads, no lighting) and its 4N-byte depth copy; the trace's T
 * pixels, each one pixel of the opaque trace (the march, the store's answer or the ray the budget pays,
 * the probes, the environment); the rays, at most `FRAME_WORK` units a frame for both surfaces together; a forward
 * fragment of the front layer, one 16-byte load. Worst case of a fragment: a deeper one, the screen
 * march (`REFLECTION_STEP_CAP` pixels) and the probes, no proxy ray. Floor: the opaque trace's own
 * cost per pixel, on the T pixels the transparents cover.
 *
 * Bytes, made with the store (`proxyStore.ts`) when the scene has transparents: 4 + 8 + 1 + 16 a
 * pixel (depth, normals, flags, radiance), the lobes target 16 more once a transparent carries a
 * lobe (`lobed`), and the store's 8 bytes of the front's cells.
 */

/** The format of the front's traced radiance: the base's and the coat's words, the depth, the stamp. */
export const FRONT_TRACED_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The formats of the front surface's targets: the surface buffer's normals and flags, and the
 *  lobes target's (`../scene/physicalLobes.ts`). */
export const FRONT_TARGET_FORMATS = {
  normals: SURFACE_FORMATS[1],
  flags: SURFACE_FORMATS[3],
  lobes: PHYSICAL_LOBES_FORMAT,
} as const
const LABEL = 'Trillion3D reflection front layer'

/** Bytes of the front layer of a view at `width × height`, its lobes target a texel. */
export const frontLayerBytes = (width: number, height: number) =>
  [DEPTH_FORMAT, FRONT_TARGET_FORMATS.normals, FRONT_TARGET_FORMATS.flags, FRONT_TRACED_FORMAT]
    .map((format) => textureBytesOf({ size: [width, height], format })!)
    .reduce(
      (sum, bytes) => sum + bytes,
      textureBytesOf({ size: [1, 1], format: PHYSICAL_LOBES_FORMAT })!,
    )

/** The stamp of the image `frame` (`run.frame`): a whole word, never zero, which no image without a
 *  front pass writes (`reflectionView.runtime.y`). */
export const frontStamp = (frame: number) => frame >>> 0 || 1

/** A view's front layer at `width × height` (`frontLayer.ts`): its targets, its traced radiance and
 *  the stamp of the last image that drew it. */
export function createFrontLayer(device: GPUDevice, width: number, height: number) {
  const attached = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const make = (format: GPUTextureFormat, usage: number, size: GPUExtent3D = [width, height]) =>
    device.createTexture({ label: LABEL, size, format, usage })
  const depth = make(DEPTH_FORMAT, attached | GPUTextureUsage.COPY_DST),
    normals = make(FRONT_TARGET_FORMATS.normals, attached),
    flags = make(FRONT_TARGET_FORMATS.flags, attached),
    traced = make(
      FRONT_TRACED_FORMAT,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    )
  let lobes = make(FRONT_TARGET_FORMATS.lobes, attached, [1, 1]),
    lobesView = lobes.createView()
  const cleared = (view: GPUTextureView): GPURenderPassColorAttachment => ({
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  })
  const depthView = depth.createView(),
    normalsView = normals.createView(),
    flagsView = flags.createView()
  const colours = [cleared(normalsView), cleared(flagsView)]
  const lobed = cleared(lobesView)
  const pass: GPURenderPassDescriptor = {
    label: TRANSPARENT_FRONT_PASS,
    colorAttachments: colours,
    // The opaque depth copied in first (`encodeFrontPass`): a surface behind it is never the front.
    depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
  }
  return {
    depth,
    depthView,
    normalsView,
    flagsView,
    get lobesView() {
      return lobesView
    },
    tracedView: traced.createView(),
    /** The stamp of the last image that drew the front pass (`frontStamp`), zero before any: what the
     *  trace writes with each pixel's radiance, and the forward fragments read it under. */
    drawn: 0,
    /** The front pass of the image of stamp `stamp`: its lobes target attached where the program
     *  writes lobes (`withLobes`), made full-size the first time, its bytes added to `bytes`. */
    begin(stamp: number, withLobes: boolean, bytes: { targetBytes: number }) {
      this.drawn = stamp
      if (withLobes && lobes.width !== width) {
        retire(device, lobes)
        lobes = make(FRONT_TARGET_FORMATS.lobes, attached)
        lobesView = lobed.view = lobes.createView()
        bytes.targetBytes += textureBytesOf({
          size: [width, height],
          format: PHYSICAL_LOBES_FORMAT,
        })!
      }
      colours.length = 2
      if (withLobes) colours.push(lobed)
      return pass
    },
    dispose() {
      for (const texture of [depth, normals, flags, traced, lobes]) texture.destroy()
    },
  }
}
export type FrontLayer = ReturnType<typeof createFrontLayer>
