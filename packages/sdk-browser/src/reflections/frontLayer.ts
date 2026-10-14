import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { SURFACE_FORMATS } from '../scene/surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT, PHYSICAL_LOBES_TARGET } from '../scene/physicalLobes.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { TRANSPARENT_FRONT_PASS } from '../stage/passLabels.ts'
import { createHalfGrids, halfBytes, halfExtent } from './halfTexture.ts'

/**
 * THE TRANSPARENTS' FRONT LAYER, the one producer of what the reflections know of the transparents.
 * Each pixel has two surfaces a ray or a reflection meets: the opaque one, and the nearest
 * transparent one. The front pass (`../webgpu/blend/frontPass.ts`) draws every transparent run once
 * more, before the depth pyramid and the trace, depth-tested and written over a copy of the opaque
 * depth, its fragment writing no colour (`../webgpu/blend/frontStageWgsl.ts`):
 *
 * - a fragment that covers its pixel (`REFLECTION_FRONT_COVERAGE`) writes its depth, a step behind
 *   the surface, into the front layer of the Hi-Z's level 0 (`GpuHiz.front`), which the nearest build
 *   folds in (`hizFrontDepth`): the same march, pyramid and radiance answer a pane as a wall, this
 *   very image's, for the reflections and the lights' screen rays alike;
 * - a fragment that reflects (lit, of the physical model) writes the surface the trace reads, as the
 *   surface buffer holds the opaque one's: its flags, its normal and roughness, its lobes.
 *
 * The nearest of the fragments that do either is kept (its depth, `depth`). The trace answers the
 * front surface as the opaque one (`traceHalf.ts`), on its own half grids (`half`) and history; the
 * upsample writes its radiance here (`traced`), both lobes' on a shared exponent. A forward fragment whose depth
 * is the front depth, in an image whose trace answered the front (`reflectionView.front.x`), reads its
 * reflection there, one load; any other — a surface behind the front one — reads the chain without
 * the proxy: the screen, the probes and the environment, never a ray.
 *
 * Made with the reflection (`gpu.ts`): its depth and flags at the view's size where the scene has
 * blends, a texel without; its normals, lobes, half grid and radiance a texel until the first pass of
 * a transparent that reflects (`begin`), then the view's size (the half grid its half), kept.
 *
 * Cost, for N pixels of the view, F transparent fragments drawn and T front pixels that reflect: the
 * front pass's 4N-byte depth copy, its N-texel clear of the Hi-Z front layer and its F fragments — the
 * base map's read, the material's where they reflect, no lighting —; the trace over the whole half
 * grid, T/4 texels traced and accumulated as the opaque surface's (`traceHalf.ts`), the rest four flag
 * loads; the upsample's T pixels; a forward fragment of the front layer, a depth texel and an 8-byte load. Worst case of
 * a fragment: a deeper one, the screen march (`REFLECTION_STEP_CAP` pixels) and the probes, no proxy
 * ray. Floor: the opaque trace's own cost, on the T pixels the reflecting transparents cover.
 *
 * Bytes: 4 + 1 a pixel (depth, flags) with blends; 8 + 8 + 12 more (normals, radiance, the three half
 * grids' 16 bytes a 2×2 block) once a transparent reflects, the lobes target's once one carries a lobe.
 */

/** The format of the front's traced radiance: the base's and the coat's words. */
export const FRONT_TRACED_FORMAT: GPUTextureFormat = 'rg32uint'
/** The formats of the front pass's targets: the Hi-Z front layer it writes the covering depth to, the
 *  surface buffer's flags and normals, and the lobes target's (`../scene/physicalLobes.ts`). */
export const FRONT_TARGET_FORMATS = {
  front: 'r32float',
  flags: SURFACE_FORMATS[3],
  normals: SURFACE_FORMATS[1],
  lobes: PHYSICAL_LOBES_FORMAT,
} as const
const LABEL = 'Trillion3D reflection front layer'
const texel = (format: GPUTextureFormat) => textureBytesOf({ size: [1, 1], format })!

/** The traced radiance's texture at `size`: written by the upsample, read by the forward programs. */
const createFrontTraced = (device: GPUDevice, size: GPUExtent3D) =>
  device.createTexture({
    label: LABEL,
    size,
    format: FRONT_TRACED_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** Bytes of the front layer of a view at `width × height` as it is made: its depth and flags at that
 *  size where the scene has `blends`, a texel without; its normals, half grid, radiance and lobes a
 *  texel. */
export const frontLayerBytes = (width: number, height: number, blends: boolean) =>
  (blends ? width * height : 1) * (texel(DEPTH_FORMAT) + texel(FRONT_TARGET_FORMATS.flags)) +
  texel(FRONT_TARGET_FORMATS.normals) +
  halfBytes(1, 1) +
  texel(FRONT_TRACED_FORMAT) +
  PHYSICAL_LOBES_TARGET.bytes(width, height, false)

/** The stamp of the image `frame` (`run.frame`): what tells the front pass of this image. */
export const frontStamp = (frame: number) => frame >>> 0 || 1

/** What a front pass writes past the depth and the flags: nothing, the reflecting surface, or it and its
 *  lobes. */
export type FrontOutputs = 0 | 1 | 2

/** A view's front layer at `width × height`, `blends` sizing it (`frontLayer.ts`). */
export function createFrontLayer(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  const attached = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const full: GPUExtent3D = [width, height],
    halfSize = halfExtent(width, height),
    one: GPUExtent3D = [1, 1]
  const make = (format: GPUTextureFormat, usage: number, size: GPUExtent3D) =>
    device.createTexture({ label: LABEL, size, format, usage })
  const depth = make(DEPTH_FORMAT, attached | GPUTextureUsage.COPY_DST, blends ? full : one),
    flags = make(FRONT_TARGET_FORMATS.flags, attached, blends ? full : one)
  let normals = make(FRONT_TARGET_FORMATS.normals, attached, one),
    lobes = make(FRONT_TARGET_FORMATS.lobes, attached, one),
    traced = createFrontTraced(device, one),
    half = createHalfGrids(device, LABEL, one)
  const cleared = (): GPURenderPassColorAttachment => ({
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  })
  const views = {
    depth: depth.createView(),
    flags: flags.createView(),
    normals: normals.createView(),
    lobes: lobes.createView(),
    traced: traced.createView(),
  }
  const [hizFront, flagsOut, normalsOut, lobesOut] = [cleared(), cleared(), cleared(), cleared()]
  flagsOut.view = views.flags
  const colours: GPURenderPassColorAttachment[] = []
  const pass: GPURenderPassDescriptor = {
    label: TRANSPARENT_FRONT_PASS,
    colorAttachments: colours,
    // The opaque depth copied in first (`encodeFrontPass`): a surface behind it is never the front.
    depthStencilAttachment: { view: views.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
  }
  /** `texture` at the view's size, the texel it replaces retired after the frame, and the bytes it adds:
   *  `bytes`, or a texel of its format a pixel past the one it had. */
  const grow = (
    texture: GPUTexture,
    remake: () => GPUTexture,
    bytes = (width * height - 1) * texel(texture.format),
  ) => {
    if (texture.width === width) return { texture, bytes: 0 }
    retire(device, texture)
    return { texture: remake(), bytes }
  }
  return {
    /** Whether it holds the view's pixels: the scene had a blend when it was made. */
    wanted: blends,
    depth,
    views,
    /** The stamp of the last image that drew the front pass, and of the last one whose pass wrote the
     *  reflecting surface (`frontStamp`): zero before any. */
    drawn: 0,
    reflected: 0,
    /** The front surface's half grids (`halfTexture.ts`): a texel until it first reflects. */
    get half() {
      return half
    },
    /** The front pass of the image of stamp `stamp`, into the Hi-Z front layer `front`, writing
     *  `outputs` (`FrontOutputs`): its normals, radiance and lobes made at the view's size the first
     *  time they are written, their bytes added to `bytes`. */
    begin(
      stamp: number,
      front: GPUTextureView,
      outputs: FrontOutputs,
      bytes: { targetBytes: number },
    ) {
      this.drawn = stamp
      hizFront.view = front
      colours.length = 0
      colours.push(hizFront, flagsOut)
      if (outputs > 0) {
        this.reflected = stamp
        const n = grow(normals, () => make(FRONT_TARGET_FORMATS.normals, attached, full)),
          t = grow(traced, () => createFrontTraced(device, full))
        if (n.texture !== normals) views.normals = (normals = n.texture).createView()
        if (t.texture !== traced) views.traced = (traced = t.texture).createView()
        bytes.targetBytes += n.bytes + t.bytes
        if (half.width !== halfSize[0]) {
          for (const texture of half.textures) retire(device, texture)
          half = createHalfGrids(device, LABEL, halfSize)
          bytes.targetBytes += halfBytes(width, height) - halfBytes(1, 1)
        }
        normalsOut.view = views.normals
        colours.push(normalsOut)
      }
      if (outputs > 1) {
        const l = grow(
          lobes,
          () => make(FRONT_TARGET_FORMATS.lobes, attached, full),
          // The lobes target's own accounting (`PHYSICAL_LOBES_TARGET`), as the surface buffer's.
          PHYSICAL_LOBES_TARGET.bytes(width, height, true) -
            PHYSICAL_LOBES_TARGET.bytes(width, height, false),
        )
        if (l.texture !== lobes) views.lobes = (lobes = l.texture).createView()
        bytes.targetBytes += l.bytes
        lobesOut.view = views.lobes
        colours.push(lobesOut)
      }
      return pass
    },
    dispose() {
      for (const texture of [depth, flags, normals, lobes, traced]) texture.destroy()
      half.destroy()
    },
  }
}
export type FrontLayer = ReturnType<typeof createFrontLayer>
