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
 * front surface as the opaque one (`trace.ts`), on its own grids (`grids`) and history, through the
 * view's resolved pixels after the opaque one; its last pass (`bilateralWgsl.ts`) writes its radiance
 * here (`traced`), both lobes' on a shared exponent. A forward fragment whose depth
 * is the front depth, in an image whose trace answered the front (`reflectionView.front.x`), reads its
 * reflection there, one load; any other — a surface behind the front one — reads the chain without
 * the proxy: the screen, the probes and the environment, never a ray.
 *
 * Made with the reflection (`gpu.ts`): its depth and flags at the view's size where the scene has
 * blends, a texel without; its normals, lobes, grids and radiance a texel until the first pass of a
 * transparent that reflects (`begin`), then the view's size, kept.
 *
 * Cost, for N pixels of the view, F transparent fragments drawn and T front pixels that reflect: the
 * front pass's 4N-byte depth copy, its N-texel clear of the Hi-Z front layer and its F fragments — the
 * base map's read, the material's where they reflect, no lighting —; the trace over the view, T pixels
 * traced, reused and accumulated as the opaque surface's (`trace.ts`), the rest a flag load each; a
 * forward fragment of the front layer, a depth texel and an 8-byte load. Worst case of
 * a fragment: a deeper one, the screen march (`REFLECTION_MARCH_STEPS` iterations) and the probes, no proxy
 * ray. Floor: the opaque trace's own cost, on the T pixels the reflecting transparents cover.
 *
 * Bytes: 4 + 1 a pixel (depth, flags) with blends; 8 + 8 + 23 more (normals, radiance, the grid's 28
 * a texel and the history's 16 a pixel, a word a tile, `gridBytes`) once a transparent reflects, the
 * lobes target's once one carries a lobe.
 */
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { SURFACE_FORMATS, holds } from '../scene/surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT, PHYSICAL_LOBES_TARGET } from '../scene/physicalLobes.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { HIZ_LEVEL0_FORMAT } from '../gpu/hiz/level0.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { TRANSPARENT_FRONT_PASS } from '../stage/passLabels.ts'
import { createKernelTexture, createReflectionGrids, gridBytes } from './grids.ts'

/** The format of the front's traced radiance: the base's and the coat's words. */
export const FRONT_TRACED_FORMAT: GPUTextureFormat = 'rg32uint'
/** How a fragment binds it: words, read by load (the blend's group). */
export const FRONT_TRACED_LAYOUT: { texture: GPUTextureBindingLayout } = {
  texture: { sampleType: 'uint' },
}
/** The front pass's outputs in their locations' order, each written from the `FrontOutputs` it names
 *  on: the Hi-Z front layer's covering depth, the surface buffer's flags and normal, the lobes'. */
const FRONT_OUTPUT = {
  front: { wgsl: 'vec4f', format: HIZ_LEVEL0_FORMAT, from: 0 },
  flags: { wgsl: 'u32', format: SURFACE_FORMATS[3], from: 0 },
  normal: { wgsl: 'vec4f', format: SURFACE_FORMATS[1], from: 1 },
  lobes: { wgsl: 'vec4u', format: PHYSICAL_LOBES_FORMAT, from: 2 },
} as const
/** What a front pass writes past the depth and the flags: nothing, the surface, or it and its lobes. */
export type FrontOutputs = (typeof FRONT_OUTPUT)[keyof typeof FRONT_OUTPUT]['from']
/** Each `FrontOutputs`' outputs in order: the stage's targets, `FrontOut` and attachments read them. */
export const FRONT_OUTPUTS = ([0, 1, 2] as const).map((outputs) =>
  Object.entries(FRONT_OUTPUT)
    .filter(([, { from }]) => from <= outputs)
    .map(([name, output]) => ({ name: name as keyof typeof FRONT_OUTPUT, ...output })),
)
const LABEL = 'Trillion3D reflection front layer'

/** The traced radiance's texture at `size`: written by the accumulation, read by the forward programs. */
const createFrontTraced = (device: GPUDevice, size: GPUExtent3D) =>
  createKernelTexture(device, LABEL, size, FRONT_TRACED_FORMAT)

/** Bytes of the front layer of a view at `width × height` as it is made: its depth and flags at that
 *  size where the scene has `blends`, a texel without; its normals, grids, radiance and lobes a texel. */
export const frontLayerBytes = (width: number, height: number, blends: boolean) =>
  (blends ? width * height : 1) *
    (texelBytesOf(DEPTH_FORMAT) + texelBytesOf(FRONT_OUTPUT.flags.format)) +
  texelBytesOf(FRONT_OUTPUT.normal.format) +
  gridBytes(1, 1) +
  texelBytesOf(FRONT_TRACED_FORMAT) +
  PHYSICAL_LOBES_TARGET.bytes(width, height, false)

/** The stamp of the image `frame` (`run.frame`): what tells the front pass of this image. */
export const frontStamp = (frame: number) => frame >>> 0 || 1

/** A view's front layer at `width × height`, `blends` sizing it (`frontLayer.ts`), its grids the
 *  opaque surface's. */
export function createFrontLayer(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  const attached = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const full: [number, number] = [width, height],
    one: [number, number] = [1, 1]
  const make = (format: GPUTextureFormat, usage: number, size: GPUExtent3D) =>
    device.createTexture({ label: LABEL, size, format, usage })
  const depth = make(DEPTH_FORMAT, attached | GPUTextureUsage.COPY_DST, blends ? full : one),
    flags = make(FRONT_OUTPUT.flags.format, attached, blends ? full : one)
  let normals = make(FRONT_OUTPUT.normal.format, attached, one),
    lobes = make(FRONT_OUTPUT.lobes.format, attached, one),
    traced = createFrontTraced(device, one),
    grids = createReflectionGrids(device, LABEL, one)
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
  const out = { front: cleared(), flags: cleared(), normal: cleared(), lobes: cleared() }
  out.flags.view = views.flags
  /** Each `FrontOutputs`' attachments, in its outputs' order. */
  const colours = FRONT_OUTPUTS.map((list) => list.map(({ name }) => out[name]))
  const pass: GPURenderPassDescriptor = {
    label: TRANSPARENT_FRONT_PASS,
    colorAttachments: colours[0],
    // The opaque depth copied in first (`encodeFrontPass`): a surface behind it is never the front.
    depthStencilAttachment: { view: views.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
  }
  /** `texture` at the view's size, the texel it replaces retired after the frame, and the bytes it adds:
   *  `bytes`, or a texel of its format a pixel past the one it had. */
  const grow = (
    texture: GPUTexture,
    remake: () => GPUTexture,
    bytes = (width * height - 1) * texelBytesOf(texture.format),
  ) => {
    if (holds({ width, height }, texture)) return { texture, bytes: 0 }
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
    /** The front surface's grids (`grids.ts`): a texel until it first reflects. */
    get grids() {
      return grids
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
      out.front.view = front
      pass.colorAttachments = colours[outputs]
      if (outputs > 0) {
        this.reflected = stamp
        const n = grow(normals, () => make(FRONT_OUTPUT.normal.format, attached, full)),
          t = grow(traced, () => createFrontTraced(device, full))
        if (n.texture !== normals) views.normals = (normals = n.texture).createView()
        if (t.texture !== traced) views.traced = (traced = t.texture).createView()
        bytes.targetBytes += n.bytes + t.bytes
        if (grids.pixels[0] < width || grids.pixels[1] < height) {
          retire(device, grids)
          grids = createReflectionGrids(device, LABEL, full)
          bytes.targetBytes += gridBytes(width, height) - gridBytes(1, 1)
        }
        out.normal.view = views.normals
      }
      if (outputs > 1) {
        const l = grow(
          lobes,
          () => make(FRONT_OUTPUT.lobes.format, attached, full),
          // The lobes target's own accounting (`PHYSICAL_LOBES_TARGET`), as the surface buffer's.
          PHYSICAL_LOBES_TARGET.bytes(width, height, true) -
            PHYSICAL_LOBES_TARGET.bytes(width, height, false),
        )
        if (l.texture !== lobes) views.lobes = (lobes = l.texture).createView()
        bytes.targetBytes += l.bytes
        out.lobes.view = views.lobes
      }
      return pass
    },
    dispose() {
      for (const texture of [depth, flags, normals, lobes, traced]) texture.destroy()
      grids.destroy()
    },
  }
}
export type FrontLayer = ReturnType<typeof createFrontLayer>
