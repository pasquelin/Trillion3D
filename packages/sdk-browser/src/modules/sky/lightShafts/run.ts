import type { SkyQualityValues } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { TaaFrameState } from '../../../post/taa/frameState.ts'
import { cameraSeen, type CameraImage } from '../../../frame/backend/state/previousCamera.ts'
import {
  lightShaftWritten,
  writeLightShaftView,
  type LightShaftPass,
  type LightShaftViewInput,
} from './describe.ts'
import { LIGHT_SHAFT_BINDING } from './wgsl.ts'
import { LIGHT_SHAFT_TEMPORAL_BINDING, LIGHT_SHAFT_TEMPORAL_VIEW } from './temporalWgsl.ts'
import { LIGHT_SHAFT_VIEW } from './wgsl.ts'
import type { LightShaftChain, LightShaftLightInput } from './plan.ts'
import type { LightShaftDraw, LightShaftBinding } from './draw.ts'
import type { LightShaftPrograms } from './programs.ts'
import {
  LIGHT_SHAFT_SLOT_FLOATS,
  type LightShaftImages,
  type LightShaftTargets,
} from './targets.ts'
import type { LightShaftSizes } from './layout.ts'
import type { LightShaftHistory } from './temporalHistory.ts'
import { writeLightShaftTemporalView } from './temporalDescribe.ts'

/** The words of a uniform being written, reused by every draw. */
const words = new Float32Array(LIGHT_SHAFT_SLOT_FLOATS) as Float32Array<ArrayBuffer>

/**
 * What the chains of an image are drawn with: the encoder and the targets, the programs, the lit
 * image and the scene's depth, the sizes of the passes, and the camera the shafts are placed by.
 * `exposure` is the factor the lit image is multiplied by before the bloom reads it
 * (`LightShaftViewInput.exposure`); `temporal`, the view's temporal state where the chains are
 * filtered over time: the state, the camera without jitter, the scale the bloom's pixels are
 * stored at (`applied`, the exposure the lit image is shown at), the one the occlusion's are
 * (`pre`, the pre-exposure) and the exposure scale the tone weights read.
 */
export interface LightShaftFrame {
  readonly encoder: GPUCommandEncoder
  readonly programs: LightShaftPrograms
  readonly targets: LightShaftTargets
  readonly draw: LightShaftDraw
  readonly images: LightShaftImages
  readonly sizes: LightShaftSizes
  readonly lit: GPUTextureView
  readonly depth: GPUTextureView
  readonly quality: Pick<SkyQualityValues, 'lightShaftFirstPassDistance'>
  readonly projection: ArrayLike<number>
  readonly exposure: number
  /** The number of this image and the view's camera of the image before (`previousCamera.ts`): a
   *  chain's history reprojects by it where its last image is that one. */
  readonly cameras: { readonly frame: number; readonly before: CameraImage }
  readonly temporal?: {
    readonly state: TaaFrameState
    readonly camera: Pick<EngineCamera, 'viewProjection' | 'eye'>
    readonly applied: number
    readonly pre: number
    readonly frameExposure: number
  }
}

/** The resources a pass reads besides its uniform, by the numbers of its layout. */
function bindingsOf(
  f: LightShaftFrame,
  pass: LightShaftPass,
  source: GPUTextureView,
): LightShaftBinding[] {
  const b = LIGHT_SHAFT_BINDING
  if (pass === 'occlusion') return [{ binding: b.depth, resource: f.depth }]
  if (pass === 'bloom')
    return [
      { binding: b.source, resource: source },
      { binding: b.depth, resource: f.depth },
    ]
  return [
    { binding: b.source, resource: source },
    { binding: b.sampler, resource: f.programs.sampler },
  ]
}

/** One pass of a chain: its uniform written for `light`, its group over `source`, drawn into
 *  `target`, the target loaded where `load` and cleared to white otherwise. */
function drawPass(
  f: LightShaftFrame,
  input: LightShaftViewInput,
  pass: LightShaftPass,
  index: number,
  source: GPUTextureView,
  target: GPUTextureView,
  load: boolean,
) {
  const slot = f.targets.slot(writeLightShaftView(words, input, pass, index))
  const program = f.programs.passes[pass]
  const group = f.draw.groupOf(
    slot,
    program.layout,
    LIGHT_SHAFT_VIEW.words * 4,
    bindingsOf(f, pass, source),
  )
  f.draw.draw(
    f.encoder,
    program.pipeline.get(),
    group,
    target,
    lightShaftWritten(pass, f.sizes),
    load,
  )
}

/** The temporal filter of a chain: `source` filtered with the history, drawn into the history's
 *  other image, which then is the held one. Returns it. */
function drawTemporal(
  f: LightShaftFrame,
  technique: 'occlusion' | 'bloom',
  source: GPUTextureView,
  history: LightShaftHistory,
) {
  const { state, camera, applied, pre, frameExposure } = f.temporal!
  const exposure = technique === 'bloom' ? applied : pre
  const slot = f.targets.slot(
    writeLightShaftTemporalView(words, {
      sizes: f.sizes,
      state,
      camera,
      history,
      before: cameraSeen(f.cameras.before, history.seen),
      exposure,
      frameExposure,
    }),
  )
  const b = LIGHT_SHAFT_TEMPORAL_BINDING
  const { temporal } = f.programs
  const pipeline = temporal.pipeline.get()
  // Not compiled: nothing drawn, the history is left as it was and the chain goes on with `source`.
  if (!pipeline) return source
  const group = f.draw.groupOf(slot, temporal.layout, LIGHT_SHAFT_TEMPORAL_VIEW.words * 4, [
    { binding: b.source, resource: source },
    { binding: b.history, resource: history.held },
    { binding: b.sampler, resource: f.programs.sampler },
    { binding: b.depth, resource: f.depth },
  ])
  f.draw.draw(f.encoder, pipeline, group, history.next, f.sizes.shaft.view, false)
  history.commit(f.sizes, exposure, f.cameras.frame)
  return history.held
}

/**
 * One light's chain (`LightShaftChain`) drawn in the order its steps are given: the reduction of the
 * scene into the first image, the temporal filter, the radial blurs, each reading the image before
 * and drawing into the other of the two images, and the end — the occlusion's into the mask
 * (`loadMask`: the mask holds what a chain before wrote and is kept, else cleared), the bloom's
 * onto the lit image.
 */
export function drawLightShaftChain(
  f: LightShaftFrame,
  chain: LightShaftChain,
  light: LightShaftLightInput,
  history: LightShaftHistory | undefined,
  loadMask: boolean,
) {
  const { scratch, mask } = f.images
  const input: LightShaftViewInput = {
    light: light.settings,
    quality: f.quality,
    sizes: f.sizes,
    origin: light.origin,
    exposure: f.exposure,
    projection: f.projection,
  }
  let current: GPUTextureView = scratch[0]
  for (const step of chain.steps) {
    if (step.kind === 'temporal') {
      current = drawTemporal(f, chain.technique, current, history!)
      continue
    }
    const { pass } = step
    if (pass === 'occlusion' || pass === 'bloom') {
      drawPass(f, input, pass, 0, f.lit, scratch[0], false)
      current = scratch[0]
    } else if (pass === 'blur') {
      const target = current === scratch[0] ? scratch[1] : scratch[0]
      drawPass(f, input, pass, step.index, current, target, false)
      current = target
    } else if (pass === 'finish') drawPass(f, input, pass, 0, current, mask, loadMask)
    else drawPass(f, input, pass, 0, current, f.lit, true)
  }
}
