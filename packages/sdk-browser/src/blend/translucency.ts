import { DEPTH_FORMAT, FEEDBACK_FORMAT, HDR_FORMAT } from '../scene/targetFormats.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { layersGroup, noModulationView } from './translucencyLayers.ts'
import { RESPONSIVE_FORMAT } from './responsive.ts'
import type { TranslucencyExtent } from './translucencyScale.ts'

/**
 * THE SEPARATE TRANSLUCENCY, the target of everything see-through — the blends and the particles.
 * The translucent layers are not drawn into the lit image: they are drawn over the depth of the opaque
 * scene into targets of their own and composed onto the image once the depth of field has read it
 * (in its recombine, `post/effects/depthOfField/dofRecombineWgsl.ts`, or where it draws none, after
 * it), so that no layer is blurred by it — but those of the pass before it, drawn and composed first,
 * which it blurs with the scene (`translucencyPhase.ts`). The layers of the pass after the motion blur
 * are drawn into a second set of targets (`late`), composed over the image once the temporal pass
 * and the motion blur have read it (`translucencyCompose.ts`).
 *
 * - The translucency target holds what the layers add (red, green, blue) and, in its alpha, the
 *   share of the scene behind them that shows through, the transmittance: cleared to black and
 *   1, each layer that lets through `1 − a` of it multiplies it by that (`BLEND_EQUATIONS`).
 * - The modulation target holds what the layers that filter the scene multiply it by: cleared to
 *   white, its alpha 0, or 1 where the alpha holdout is on, the composition then leaving the image's
 *   alpha as it is.
 *
 * The image is the scene times the modulation times the transmittance, plus the light the layers
 * add (`layersOver`); its alpha, where it carries one (`propagateAlpha`), the scene's times the
 * transmittance and times the background the modulation leaves visible, the mean of the
 * modulation's channels.
 */
export interface TranslucencyTargets {
  color: GPUTexture
  colorView: GPUTextureView
  modulation: GPUTexture
  modulationView: GPUTextureView
  /** The group the composition reads both from (`translucencyLayers.ts`). */
  group: GPUBindGroup
  /** The group it reads the translucency target and a white modulation from, for an image none of
   *  whose layers modulated the scene. */
  groupBare: GPUBindGroup
  /** The pass of this image's layers that multiply the scene drew into the modulation target
   *  (`drawModulation`); else it was not cleared, and the composition reads a white one. */
  modulated: boolean
  /** True when the textures are at the target size: the scene has translucent layers. */
  active: boolean
  /** The size of the textures. */
  extent: readonly [number, number]
  /** The size the layers are drawn at this image, within `extent` (`fitLayers`); the textures' own where they are not smaller than the
   *  image's. */
  drawn: [number, number]
  /** What the textures smaller than the image (`translucencyScale.ts`) add: the layers drawn into them are tested against a depth taken at
   *  their size and composed scaled up. None where the textures are the image's size; made and given back whole. */
  reduced?: ReducedLayers
  /** Where this image stands with them: `idle`, they hold nothing of it; `drawn`, it drew into them,
   *  which its composition waits for; `fused`, the depth of field composed them into its own output
   *  (`markFused`), the lit image waiting for them still; `shown`, it composed them, so they hold
   *  what its image was composed with, which the temporal pass reads (`shownTranslucency`) until the
   *  next image draws. Moved by `markDrawn`, `markFused`, `settle` and `forget` only. */
  phase: 'idle' | 'drawn' | 'fused' | 'shown'
  /** The targets of the layers drawn after the motion blur, made while the scene holds some; they
   *  have no `late` of their own. */
  late?: TranslucencyTargets
  /** The alpha holdout's target (`holdout.ts`), made at the first image that holds out, at the size of
   *  the targets; the late set has none. */
  holdout?: { texture: GPUTexture; view: GPUTextureView; pending: boolean }
  /** The image the late layers are composed into, at the display's size or the render's, the
   *  larger: the late set's. */
  lateImage?: { texture: GPUTexture; view: GPUTextureView }
}

/** What a set of textures smaller than the image holds beside them (`TranslucencyTargets.reduced`). */
export interface ReducedLayers {
  /** True when this image's layers are drawn at a size other than the image's (`fitLayers`): only then do the passes of the smaller layers
   *  run (their depth, feedback, marks and the scaled-up composition). False where the share and the basis leave the layers the image's
   *  size. */
  apart: boolean
  /** The scene's depth at the textures' size, the layers' depth test (`translucencyDepth.ts`); the late set holds the first set's. */
  depthView: GPUTextureView
  /** The texture behind `depthView`, owned by the first set. */
  depthTexture?: GPUTexture
  /** Whether the depth is made this image (`layersReady`): the layers are not drawn before. Read on the first set's (`depthOwner`). */
  depthReady: boolean
  /** The late set's link to the first set's, which owns the depth and its state. */
  main?: ReducedLayers
  /** The texture feedback the layers write, at the textures' size and read by nothing: the layers write the request of the image's
   *  pixels, which the smaller target cannot hold. */
  feedbackTexture: GPUTexture
  feedbackView: GPUTextureView
  /** Whether a pass of this image's layers posted requests in `feedbackView`, which is then cleared no more (`layersFeedback`) and laid
   *  over the image's feedback target after the passes (`layReducedFeedback`). */
  feedbackPosted: boolean
  /** The marks of the responsiveness pass (`translucencyResponsive.ts`), made when it first draws. */
  responsive?: { texture: GPUTexture; view: GPUTextureView }
  /** What this set's composition at scale reads its place from (`translucencyCompose.ts`), made at the first composition. */
  upsample?: UpsampleState
}

/** The set that owns the depth of `reduced`: the first, which the late set links to. */
export const depthOwner = (reduced: ReducedLayers) => reduced.main ?? reduced

/** Whether the layers of `set` are drawn at a size other than the image's this image. */
export const layersApart = (set: Pick<TranslucencyTargets, 'reduced'> | undefined) =>
  !!set?.reduced?.apart

/** The words of the place the smaller layers `set` are composed from, their buffer, and the group that binds them with the depths of the
 *  layers and of the scene, made again when either depth changes. */
export interface UpsampleState {
  uniform: GPUBuffer
  floats: Float32Array<ArrayBuffer>
  group?: GPUBindGroup
  low?: GPUTextureView
  full?: GPUTextureView
}

/** The image drew into the targets. */
export const markDrawn = (translucency: TranslucencyTargets) => {
  translucency.phase = 'drawn'
}
/** The depth of field composed the targets into its output. */
export const markFused = (translucency: TranslucencyTargets) => {
  translucency.phase = 'fused'
}
/** The image composed the targets it drew: they hold what it was composed with. */
export const settle = (translucency: TranslucencyTargets) => {
  translucency.phase = 'shown'
}
/** The targets hold nothing the image or the temporal pass reads. */
export const forget = (translucency: TranslucencyTargets) => {
  translucency.phase = 'idle'
}

/** The clear of the translucency target, then of the modulation target. With the alpha holdout the
 *  modulation target's alpha is cleared to 1 (`MODULATION_KEEPS_ALPHA`): the composition then leaves
 *  the image's alpha as it is, the holdout laying its own (`holdout.ts`). */
export const TRANSLUCENCY_CLEAR: GPUColor = [0, 0, 0, 1]
export const MODULATION_CLEAR: GPUColor = [1, 1, 1, 0]
export const MODULATION_KEEPS_ALPHA: GPUColor = [1, 1, 1, 1]

const HDR_TEXEL = texelBytesOf(HDR_FORMAT),
  DEPTH_TEXEL = texelBytesOf(DEPTH_FORMAT),
  FEEDBACK_TEXEL = texelBytesOf(FEEDBACK_FORMAT),
  MARKS_TEXEL = texelBytesOf(RESPONSIVE_FORMAT)

/** Bytes of the targets of a frame at `width × height`, none beyond a texel each where the scene
 *  has no translucent layer (`active`, `sceneBlends`): the two of the layers, and where some are
 *  drawn after the motion blur (`late`) two more and the image they are composed into, at
 *  `image` (the larger of the display's size and the render's; unused without `late`).
 *  Smaller (`scaled`), the first set adds its depth (the late set shares it), and each set its texture feedback and its responsiveness
 *  marks: exactly what `createTranslucency` and the first pass that marks make. */
export const translucencyBytes = (
  active: boolean,
  late: boolean,
  width: number,
  height: number,
  image: readonly [number, number],
  scaled = false,
) =>
  active
    ? 2 * width * height * HDR_TEXEL +
      (late ? (2 * width * height + image[0] * image[1]) * HDR_TEXEL : 0) +
      (scaled
        ? width * height * (DEPTH_TEXEL + (FEEDBACK_TEXEL + MARKS_TEXEL) * (late ? 2 : 1))
        : 0)
    : 0

/** The two targets, a texel each unless `active`, and the groups the composition reads them by. */
function createTargets(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
  extent?: TranslucencyExtent,
): TranslucencyTargets {
  if (active && extent?.scaled) [width, height] = [extent.width, extent.height]
  const size = { width: active ? width : 1, height: active ? height : 1 }
  const made = (label: string) =>
    device.createTexture({
      label,
      size,
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  const color = made('Trillion3D translucency'),
    modulation = made('Trillion3D translucency modulation')
  const colorView = color.createView(),
    modulationView = modulation.createView()
  return {
    color,
    colorView,
    modulation,
    modulationView,
    group: layersGroup(device, 'Trillion3D translucency', colorView, modulationView),
    groupBare: layersGroup(
      device,
      'Trillion3D translucency, nothing modulated',
      colorView,
      noModulationView(device),
    ),
    modulated: false,
    active,
    extent: [size.width, size.height],
    drawn: [size.width, size.height],
    phase: 'idle',
  }
}

/**
 * The targets of an image at `width × height`, a texel each unless `active`; with `lateImage`, the
 * size of the image the late layers are composed into, the second set of the layers drawn after the
 * motion blur and that image too.
 */
export function createTranslucency(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
  lateImage?: readonly [number, number],
  extent?: TranslucencyExtent,
): TranslucencyTargets {
  const targets = createTargets(device, width, height, active, extent)
  const smaller = active && !!extent?.scaled
  if (smaller) targets.reduced = createReduced(device, targets)
  if (active && lateImage) {
    targets.late = createTargets(device, width, height, true, extent)
    if (smaller) targets.late.reduced = createReduced(device, targets.late, targets.reduced)
    const texture = device.createTexture({
      label: 'Trillion3D translucency late image',
      size: lateImage,
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    targets.lateImage = { texture, view: texture.createView() }
  }
  return targets
}

/** What the smaller textures `set` add: the texture feedback it writes and the depth — made by the first set, linked from the late one
 *  (`main`). */
function createReduced(
  device: GPUDevice,
  set: TranslucencyTargets,
  main?: ReducedLayers,
): ReducedLayers {
  const size = [set.extent[0], set.extent[1]]
  const feedbackTexture = device.createTexture({
    label: 'Trillion3D translucency feedback',
    size,
    format: FEEDBACK_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const own = {
    apart: false,
    depthReady: false,
    feedbackTexture,
    feedbackView: feedbackTexture.createView(),
    feedbackPosted: false,
  }
  if (main) return { ...own, depthView: main.depthView, main }
  const depthTexture = device.createTexture({
    label: 'Trillion3D translucency depth',
    size,
    format: DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  return { ...own, depthTexture, depthView: depthTexture.createView() }
}

/** Gives back what `createReduced` made and the marks and the place's uniform made later. */
function disposeReduced(reduced: ReducedLayers | undefined) {
  if (!reduced) return
  reduced.depthTexture?.destroy()
  reduced.feedbackTexture.destroy()
  reduced.responsive?.texture.destroy()
  reduced.upsample?.uniform.destroy()
}

/** The translucency this image was composed with, `undefined` where it composed none: what the temporal pass reads of it — at the image's
 *  size, or smaller (`translucencyScale.ts`), read through `shownTranslucencyDrawn`. */
export const shownTranslucency = (gpu: { translucency?: TranslucencyTargets }) =>
  gpu.translucency?.phase === 'shown' ? gpu.translucency.colorView : undefined

/** Whether the translucency `shownTranslucency` returns was drawn at a size other than the image's (`TranslucencyTargets.reduced`). */
export const shownTranslucencyScaled = (gpu: { translucency?: TranslucencyTargets }) =>
  gpu.translucency?.phase === 'shown' && layersApart(gpu.translucency)

/** The size in texels the translucency `shownTranslucency` returns was drawn at, written into `into` for the temporal pass's uniform;
 *  zero where it is the image's size, or none was shown. */
export function shownTranslucencyDrawn(
  gpu: { translucency?: TranslucencyTargets },
  into: Float32Array,
) {
  const set = gpu.translucency
  const scaled = shownTranslucencyScaled(gpu)
  into[0] = scaled ? set!.drawn[0] : 0
  into[1] = scaled ? set!.drawn[1] : 0
  return into
}

/** Gives the targets back: the textures, the late set's and image. The buffers the sorted layers are collected in are the frame's, given back
 *  with it (`disposeOit`): the targets alone are made again when the share changes. */
export function disposeTranslucency(gpu: { translucency?: TranslucencyTargets }) {
  const targets = gpu.translucency
  if (!targets) return
  for (const set of [targets, targets.late]) {
    set?.color.destroy()
    set?.modulation.destroy()
    disposeReduced(set?.reduced)
  }
  targets.lateImage?.texture.destroy()
  targets.holdout?.texture.destroy()
  gpu.translucency = undefined
}
