import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { layersGroup, noModulationView } from './translucencyLayers.ts'

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

const HDR_TEXEL = texelBytesOf(HDR_FORMAT)

/** Bytes of the targets of a frame at `width × height`, none beyond a texel each where the scene
 *  has no translucent layer (`active`, `sceneBlends`): the two of the layers, and where some are
 *  drawn after the motion blur (`late`) two more and the image they are composed into, at
 *  `image` (the larger of the display's size and the render's). */
export const translucencyBytes = (
  active: boolean,
  late: boolean,
  width: number,
  height: number,
  image: readonly [number, number],
) =>
  active
    ? 2 * width * height * HDR_TEXEL +
      (late ? (2 * width * height + image[0] * image[1]) * HDR_TEXEL : 0)
    : 0

/** The two targets, a texel each unless `active`, and the groups the composition reads them by. */
function createTargets(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
): TranslucencyTargets {
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
): TranslucencyTargets {
  const targets = createTargets(device, width, height, active)
  if (active && lateImage) {
    targets.late = createTargets(device, width, height, true)
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

/** The translucency this image was composed with, `undefined` where it composed none: what the
 *  temporal pass reads of it. */
export const shownTranslucency = (gpu: { translucency?: TranslucencyTargets }) =>
  gpu.translucency?.phase === 'shown' ? gpu.translucency.colorView : undefined

/** Gives the targets back: the textures, the late set's and image. */
export function disposeTranslucency(gpu: { translucency?: TranslucencyTargets }) {
  const targets = gpu.translucency
  if (!targets) return
  for (const set of [targets, targets.late]) {
    set?.color.destroy()
    set?.modulation.destroy()
  }
  targets.lateImage?.texture.destroy()
  targets.holdout?.texture.destroy()
  gpu.translucency = undefined
}
