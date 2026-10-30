/**
 * THE TRANSPARENTS' FRONT LAYER, the one producer of what the reflections know of the transparents.
 * Each pixel has two surfaces a ray or a reflection meets: the opaque one, and the nearest
 * transparent one. The front pass (`../../blend/frontPass.ts`) draws every transparent run once
 * more, before the depth pyramid and the trace, depth-tested and written over a copy of the opaque
 * depth, its fragment writing no colour (`../../blend/frontStageWgsl.ts`):
 *
 * - a fragment that covers its pixel (`REFLECTION_FRONT_COVERAGE`) writes its depth, a step behind
 *   the surface, into the front layer of the Hi-Z's level 0 (`GpuHiz.front`), which the full build
 *   folds in (`hizFrontDepth`): the same march, pyramid and radiance answer a pane as a wall, this
 *   very image's, for the reflections and the lights' screen rays alike;
 * - a fragment that reflects (lit, of the physical model) writes the surface the trace reads, as the
 *   surface buffer holds the opaque one's: its flags, its normal and roughness, its lobes — where the settings trace the front
 *   layer (`ReflectionSettings.frontLayer`, `reflectionFrontLayer`: off by default, never at the level `high`, always at
 *   `cinematic`); without it the pass writes the covering depth alone and no front surface is traced.
 *
 * The nearest of the fragments that do either is kept (its depth, `depth`). The trace answers the
 * front surface as the opaque one (`trace/trace.ts`), on its own grids (`grids`) and history, through the
 * view's resolved pixels after the opaque one; its last pass (`bilateralWgsl.ts`) writes its radiance
 * here (`traced`), both lobes' on a shared exponent. A forward fragment whose depth
 * is the front depth, in an image whose trace answered the front (`reflectionView.front.x`), reads its
 * reflection there, one load; any other — a surface behind the front one — reads the chain without
 * the scene trace: the screen, the probes and the environment, never a ray.
 *
 * Made with the reflection (`gpu.ts`): its depth and flags at the view's size where the scene has
 * blends, a texel without; its normals, lobes, grids and radiance a texel until the first pass of a
 * transparent that reflects (`begin`), then the view's size, kept.
 *
 * Cost, for N pixels of the view, F transparent fragments drawn and T front pixels that reflect: the
 * front pass's 4N-byte depth copy, its N-texel clear of the Hi-Z front layer and its F fragments — the
 * base map's read, the material's where they reflect, no lighting —; the trace over the view, T pixels
 * traced, reused and accumulated as the opaque surface's (`trace/trace.ts`), the rest a flag load each; a
 * forward fragment of the front layer, a depth texel and an 8-byte load. Worst case of
 * a fragment: a deeper one, the screen march (`reflectionScreenSteps` iterations) and the probes, no scene
 * ray. Floor: the opaque trace's own cost, on the T pixels the reflecting transparents cover.
 *
 * Bytes: 4 + 4 a pixel (depth, flags) with blends; 8 + 8 + 23 more (normals, radiance, the grid's 28
 * a texel and the history's 16 a pixel, a word a tile, `gridBytes`) once a transparent reflects, the
 * lobes target's once one carries a lobe.
 */
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { SURFACE_FORMATS, holds } from '../../materials/surface/surfaceBuffer.ts'
import {
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_LOBES_TARGET,
} from '../../materials/surface/physicalLobes.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { HIZ_LEVEL0_FORMAT } from '../../visibility/hiz/gpu/level0.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { TRANSPARENT_FRONT_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createKernelTexture, createReflectionGrids, gridBytes } from './grids.ts'
import { storageTextureLayout } from '../../gpu/core/computeBindings.ts'
import { createFrontTiles, frontTileBytes, type FrontTiles } from './frontTiles.ts'

/** The format of the front's traced radiance: the base's and the coat's words, then the bits of the front pass's depth at the pixel (`z`, written by
 *  the last pass, which the forward programs match a fragment's depth against: the front depth needs no texture of its own in their group), a word spare. */
export const FRONT_TRACED_FORMAT: GPUTextureFormat = 'rgba32uint'
/** How a fragment binds it: words, read by load alone, as a read-only storage texture (the blend's
 *  group, `loadOnlyTarget`): none of the sixteen sampled textures of the stage is spent on it. */
export const FRONT_TRACED_LAYOUT = storageTextureLayout(FRONT_TRACED_FORMAT)
/** The front pass's outputs in their locations' order, each written from the `FrontOutputs` it names
 *  on: the Hi-Z front layer's covering depth, the surface buffer's flags and normal, the lobes'. */
const FRONT_OUTPUT = {
  front: { wgsl: 'vec4f', format: HIZ_LEVEL0_FORMAT, from: 0 },
  flags: { wgsl: 'u32', format: SURFACE_FORMATS[3], from: 0 },
  normal: { wgsl: 'vec4f', format: SURFACE_FORMATS[1], from: 1 },
  lobes: { wgsl: 'vec4u', format: PHYSICAL_LOBES_FORMAT, from: 2 },
  base: { wgsl: 'vec4f', format: SURFACE_FORMATS[0], from: 3 },
} as const
/** What a front pass writes past the depth and the flags: nothing, the surface, it and its lobes, or those and the base colour and metalness (what the sampled lighting of the layer reads). */
export type FrontOutputs = (typeof FRONT_OUTPUT)[keyof typeof FRONT_OUTPUT]['from']
/** Each `FrontOutputs`' outputs in order: the stage's targets, `FrontOut` and attachments read them. */
export const FRONT_OUTPUTS = ([0, 1, 2, 3] as const).map((outputs) =>
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

/** The stamp of the image `frame` (`run.frame`, which starts at 0): what tells the front pass of this image, one past the number so that zero stays the stamp of no image
 *  and no two images share one (images 0 and 1 would, were zero mapped to one). */
export const frontStamp = (frame: number) => (frame + 1) >>> 0

/** The textures of a front layer, each held until the view needs it wider, and the views of them a pass and a program
 *  bind: made a texel big, but for the depth and flags of a scene that has blends. */
type FrontHeld = {
  depth: GPUTexture
  flags: GPUTexture
  normals: GPUTexture
  lobes: GPUTexture
  traced: GPUTexture
  /** The surface buffer the sampled lighting reads the layer as (`FrontSurface`), made at the view's size the first time a pass writes the base colour. */
  surface?: FrontSurface
  /** The tiles the layer lights (`FrontTiles`), made with the surface. */
  tiles?: FrontTiles
  grids: ReturnType<typeof createReflectionGrids>
  views: {
    depth: GPUTextureView
    flags: GPUTextureView
    normals: GPUTextureView
    lobes: GPUTextureView
    traced: GPUTextureView
  }
}

/**
 * The front layer as the buffer of an opaque surface is laid out, for the passes that light a surface: the base colour and metalness (layer 0) and the normal and roughness
 * (layer 1) of the layer, its flags, the base the front pass wrote and the rest copied after it (`FrontLayer.surfaceFrom`).
 */
export interface FrontSurface {
  readonly colours: GPUTexture
  readonly words: GPUTexture
  readonly coloursView: GPUTextureView
  readonly wordsView: GPUTextureView
  /** The layer 0 of the colours, which the front pass draws the base colour into. */
  readonly baseView: GPUTextureView
}

/** The usage of a texture the front pass draws into and a program reads (read where made: the globals are the device's). */
const attached = () => GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
const frontTexture = (
  device: GPUDevice,
  format: GPUTextureFormat,
  usage: number,
  size: GPUExtent3D,
) => device.createTexture({ label: LABEL, size, format, usage })

/** The textures of a front layer at `width × height`, `blends` sizing its depth and flags. */
function createFrontHeld(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
): FrontHeld {
  const full: [number, number] = [width, height],
    one: [number, number] = [1, 1]
  const depth = frontTexture(
      device,
      DEPTH_FORMAT,
      attached() | GPUTextureUsage.COPY_DST,
      blends ? full : one,
    ),
    flags = frontTexture(device, FRONT_OUTPUT.flags.format, attached(), blends ? full : one),
    normals = frontTexture(device, FRONT_OUTPUT.normal.format, attached(), one),
    lobes = frontTexture(device, FRONT_OUTPUT.lobes.format, attached(), one),
    traced = createFrontTraced(device, one)
  const views = {
    depth: depth.createView(),
    flags: flags.createView(),
    normals: normals.createView(),
    lobes: lobes.createView(),
    traced: traced.createView(),
  }
  return {
    depth,
    flags,
    normals,
    lobes,
    traced,
    grids: createReflectionGrids(device, LABEL, one),
    views,
  }
}

function createFrontSurface(device: GPUDevice, width: number, height: number): FrontSurface {
  const colours = device.createTexture({
    label: LABEL,
    size: [width, height, 2],
    format: SURFACE_FORMATS[0]!,
    usage: attached() | GPUTextureUsage.COPY_DST,
  })
  const words = device.createTexture({
    label: LABEL,
    size: [width, height, 1],
    format: SURFACE_FORMATS[3]!,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  return {
    colours,
    words,
    coloursView: colours.createView({ dimension: '2d-array' }),
    wordsView: words.createView({ dimension: '2d-array' }),
    baseView: colours.createView({ dimension: '2d', baseArrayLayer: 0, arrayLayerCount: 1 }),
  }
}

/** `texture` at the view's size, the texel it replaces retired after the frame, and the bytes it adds:
 *  `bytes`, or a texel of its format a pixel past the one it had. */
function growFront(
  device: GPUDevice,
  size: { width: number; height: number },
  texture: GPUTexture,
  remake: () => GPUTexture,
  bytes = (size.width * size.height - 1) * texelBytesOf(texture.format),
) {
  if (holds(size, texture)) return { texture, bytes: 0 }
  retire(device, texture)
  return { texture: remake(), bytes }
}

/** The front layer's normals, radiance and grids made at the view's size, the first time `outputs` ask for them, and its lobes
 *  the first time they ask for those, their bytes added to `bytes`. */
function growFrontHeld(
  device: GPUDevice,
  size: { width: number; height: number },
  held: FrontHeld,
  outputs: FrontOutputs,
  bytes: { targetBytes: number },
) {
  const { width, height } = size,
    { views } = held
  if (outputs > 0) {
    const n = growFront(device, size, held.normals, () =>
        frontTexture(device, FRONT_OUTPUT.normal.format, attached(), [width, height]),
      ),
      // Twice the view tall while the sampled lighting lights the layer: its light lies in the second half (`manyLightsSampled/frontLightWgsl.ts`).
      tracedSize = { width, height: outputs > 2 ? height * 2 : height },
      t = growFront(device, tracedSize, held.traced, () =>
        createFrontTraced(device, [tracedSize.width, tracedSize.height]),
      )
    if (n.texture !== held.normals) views.normals = (held.normals = n.texture).createView()
    if (t.texture !== held.traced) views.traced = (held.traced = t.texture).createView()
    bytes.targetBytes += n.bytes + t.bytes
    if (held.grids.pixels[0] < width || held.grids.pixels[1] < height) {
      retire(device, held.grids)
      held.grids = createReflectionGrids(device, LABEL, [width, height])
      bytes.targetBytes += gridBytes(width, height) - gridBytes(1, 1)
    }
  }
  if (outputs > 1) {
    const l = growFront(
      device,
      size,
      held.lobes,
      () => frontTexture(device, FRONT_OUTPUT.lobes.format, attached(), [width, height]),
      // The lobes target's own accounting (`PHYSICAL_LOBES_TARGET`), as the surface buffer's.
      PHYSICAL_LOBES_TARGET.bytes(width, height, true) -
        PHYSICAL_LOBES_TARGET.bytes(width, height, false),
    )
    if (l.texture !== held.lobes) views.lobes = (held.lobes = l.texture).createView()
    bytes.targetBytes += l.bytes
  }
  if (outputs > 2 && !(held.surface && holds(size, held.surface.colours))) {
    if (held.surface) {
      retire(device, held.surface.colours)
      retire(device, held.surface.words)
    }
    if (held.tiles) retire(device, held.tiles)
    held.surface = createFrontSurface(device, width, height)
    held.tiles = createFrontTiles(device, width, height)
    bytes.targetBytes +=
      width * height * (2 * texelBytesOf(SURFACE_FORMATS[0]!) + texelBytesOf(SURFACE_FORMATS[3]!)) +
      frontTileBytes(width, height)
  }
}

const cleared = (): GPURenderPassColorAttachment => ({
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
  clearValue: [0, 0, 0, 0],
})

/** The front pass's attachments: one per output (`FRONT_OUTPUT`), the pass descriptor over the depth copy, and each `FrontOutputs`' attachments in its outputs' order. */
function frontPassTargets(views: FrontHeld['views']) {
  const out = {
    front: cleared(),
    flags: cleared(),
    normal: cleared(),
    lobes: cleared(),
    base: cleared(),
  }
  out.flags.view = views.flags
  const colours = FRONT_OUTPUTS.map((list) => list.map(({ name }) => out[name]))
  const pass: GPURenderPassDescriptor = {
    label: TRANSPARENT_FRONT_PASS,
    colorAttachments: colours[0],
    // The opaque depth copied in first (`encodeFrontPass`): a surface behind it is never the front.
    depthStencilAttachment: { view: views.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
  }
  return { out, colours, pass }
}

/** The front pass's attachments for `outputs`: its normals, radiance and lobes made at the view's size the first time they are written, their bytes added to `bytes`. */
function beginFrontOutputs(
  device: GPUDevice,
  size: { width: number; height: number },
  held: FrontHeld,
  targets: ReturnType<typeof frontPassTargets>,
  outputs: FrontOutputs,
  bytes: { targetBytes: number },
) {
  const { out, colours, pass } = targets
  pass.colorAttachments = colours[outputs]
  growFrontHeld(device, size, held, outputs, bytes)
  if (outputs > 0) out.normal.view = held.views.normals
  if (outputs > 1) out.lobes.view = held.views.lobes
  if (outputs > 2) out.base.view = held.surface!.baseView
  return pass
}

/** The layer's normals and flags copied next to the base colour the pass wrote (`FrontLayer.surfaceFrom`). */
function copyIntoSurface(encoder: GPUCommandEncoder, held: FrontHeld, surface: FrontSurface) {
  const size = [surface.colours.width, surface.colours.height] as const
  encoder.copyTextureToTexture(
    { texture: held.normals },
    { texture: surface.colours, origin: [0, 0, 1] },
    size,
  )
  encoder.copyTextureToTexture({ texture: held.flags }, { texture: surface.words }, size)
}

/** Gives back everything a front layer holds. */
function destroyHeld(held: FrontHeld) {
  for (const texture of [held.depth, held.flags, held.normals, held.lobes, held.traced])
    texture.destroy()
  held.surface?.colours.destroy()
  held.surface?.words.destroy()
  held.tiles?.destroy()
  held.grids.destroy()
}

/** A view's front layer at `width × height`, `blends` sizing it (`frontLayer.ts`), its grids the
 *  opaque surface's. */
export function createFrontLayer(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
) {
  const held = createFrontHeld(device, width, height, blends),
    { views } = held
  const targets = frontPassTargets(views)
  return {
    /** Whether it holds the view's pixels: the scene had a blend when it was made. */
    wanted: blends,
    depth: held.depth,
    views,
    /** The stamp of the last image that drew the front pass, and of the last one whose pass wrote the
     *  reflecting surface (`frontStamp`): zero before any. */
    drawn: 0,
    reflected: 0,
    /** The stamp of the last image whose pass wrote the layer as a surface (`surfaceFrom`): zero before any. */
    surfaced: 0,
    /** The layer as a surface buffer's layers, once a pass wrote it. */
    get surface() {
      return held.surface
    },
    /** The tiles the layer lights, once a pass of `outputs` 3 made them. */
    get tiles() {
      return held.tiles
    },
    /** The front surface's grids (`grids.ts`): a texel until it first reflects. */
    get grids() {
      return held.grids
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
      targets.out.front.view = front
      if (outputs > 0) this.reflected = stamp
      return beginFrontOutputs(device, { width, height }, held, targets, outputs, bytes)
    },
    /** The layer as a surface buffer's layers (`FrontSurface`), after a pass of `outputs` 3: its normals and flags copied next to the base colour the pass wrote. */
    surfaceFrom(encoder: GPUCommandEncoder): FrontSurface | undefined {
      const { surface } = held
      if (!surface) return undefined
      this.surfaced = this.drawn
      copyIntoSurface(encoder, held, surface)
      return surface
    },
    /** The anisotropic and clear-coat lobes of the layer, the target the lit pixel's statements read. */
    get lobesView() {
      return views.lobes
    },
    dispose() {
      destroyHeld(held)
    },
  }
}
export type FrontLayer = ReturnType<typeof createFrontLayer>
