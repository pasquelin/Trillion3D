import {
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
  type AmbientOcclusionMode,
  type AmbientOcclusionSettings,
  type IndirectLightState,
} from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { cameraSeen, previousCameraOf } from '../../frame/backend/state/previousCamera.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import { ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import { lightingPhase } from '../surfaceCache/lighting/phase.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { readScreenProbeSetting } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { discMethod } from './discFrame.ts'
import {
  createHorizonHistory,
  horizonMethod,
  settlingImages,
  type HorizonHistory,
} from './horizon/frame.ts'
import type { AoMethod, AoNeeded } from './method.ts'
import type { AoImage } from './params.ts'
import { aoViewBytes, ensureAoView, type AoView, type AoViewSpec } from './view.ts'

/** The method the settings ask for, made for them (the horizon method over the history the state keeps). */
const methodOf = (settings: AmbientOcclusionSettings, history: HorizonHistory): AoMethod =>
  settings.method === 'horizon' ? horizonMethod(settings, history) : discMethod(settings)

/** The view a refused spec asked for and the bytes it would take: asked again once the device's room holds them, or the spec moves. */
interface Refusal {
  readonly spec: AoViewSpec
  readonly bytes: number
}

/** The occlusion a view keeps: its settings read once and again when one moved, the method they make — over the history the
 *  horizon method keeps through a change of settings —, the textures it draws, what the lighting reads this image (`output`: none
 *  where the image drew none, `why` then names the budget's refusal where that was the cause) and the objects an image
 *  refills instead of making. Held on the view's GPU state (`WebgpuGpuState.ambientOcclusion`), counted in its bytes. */
export interface AmbientOcclusion {
  readonly watch: ReturnType<typeof settingsWatch<typeof AMBIENT_OCCLUSION_RULES>>
  settings: AmbientOcclusionSettings
  method: AoMethod
  readonly history: HorizonHistory
  /** What the image's indirect light is, read each image (`indirectLight`) into this one object: none is made a frame. */
  readonly indirect: IndirectLightState
  /** What an image needs of the frame and what the passes are told of it: filled once, refilled each image. */
  needed: AoNeeded | undefined
  readonly image: AoImage
  view: AoView | undefined
  output: GPUTextureView | undefined
  /** How the lighting applies the texture this image — its mode's code and share (`DeferredLighting.setAmbientOcclusion`) — and
   *  why a view could not be made: the budget's reason. */
  code: number
  amount: number
  why: string | undefined
  refusal: Refusal | undefined
  /** The revision of the temporal state the last image was drawn at: another one drops the horizon method's history. */
  revision: number
  /** Bytes the textures hold. */
  readonly bytes: number
  /** Gives the textures back. */
  dispose(): void
}

/** An occlusion with nothing drawn yet. */
function createAmbientOcclusion(): AmbientOcclusion {
  const watch = settingsWatch(AMBIENT_OCCLUSION_RULES)
  const settings = resolveAmbientOcclusion(watch.read({}))
  const history = createHorizonHistory()
  const state: AmbientOcclusion = {
    watch,
    settings,
    method: methodOf(settings, history),
    history,
    indirect: { bounce: false, shortRange: true },
    needed: undefined,
    image: {
      view: [0, 0],
      extent: [0, 0],
      projection: [],
      world: [],
      perspective: true,
      noiseIndex: 0,
      frame: 0,
      viewProjection: [],
      historyCut: false,
      before: undefined,
      accumulates: false,
    },
    view: undefined,
    output: undefined,
    code: 0,
    amount: 0,
    why: undefined,
    refusal: undefined,
    revision: -1,
    get bytes() {
      return state.view?.bytes ?? 0
    },
    dispose() {
      state.view?.dispose()
      state.view = state.output = undefined
      history.view = undefined
      history.valid = false
      history.images = 0
      history.seen = 0
    },
  }
  return state
}

/** Whether the view's occlusion still builds its temporal history: the last image drew the horizon method with its temporal filter,
 *  and fewer images than it takes to bring the history within a tenth of its limit (`settlingImages`) were drawn on it — a quiet
 *  view is drawn again till then, not held on an occlusion of one image, two directions a pixel and a phase of the turn. */
export function ambientOcclusionSettling(rt: WebgpuPagesRuntime) {
  const state = rt.gpu.ambientOcclusion
  if (!state?.output) return false
  const { method, horizon } = state.settings
  return (
    method === 'horizon' && horizon.temporal && state.history.images < settlingImages(horizon.blend)
  )
}

/**
 * What the image's indirect light is: whether the bounce is on — the world's probes, and the screen probes over them,
 * light the pixels, so that the probes' own occlusion is the one there — and the short-range occlusion's switch as written,
 * which decides whether the probes' light is occluded here (`ambientOcclusionMode`). The reference decides on the settings:
 * a bounce that has not yet rigged its probes counts.
 */
function indirectLight(rt: WebgpuPagesRuntime, into: IndirectLightState) {
  into.bounce = rt.bounce.wanted
  into.shortRange = readScreenProbeSetting(rt, 'screenProbeShortRangeOcclusion')
  return into
}

/** What an image needs of the frame to draw the occlusion, or nothing while it lacks any of it: the device, the G-buffer, the
 *  depth pyramid the image drew, a lit view and the lighting's stand-in; the vectors of motion where the velocity stage
 *  measured them. The state's one object, refilled. */
function neededOf(rt: WebgpuPagesRuntime, state: AmbientOcclusion) {
  const { gpu, vis, run } = rt
  const depth = vis.gpuHiz?.depth()
  if (!gpu.device || !gpu.surfaces || !gpu.deferred || !depth || !run.depthDrawn) return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  const { velocity } = gpu
  const needed = (state.needed ??= {
    device: gpu.device,
    normals: gpu.surfaces.views()[1],
    depth,
    empty: gpu.deferred.placeholders.ambientOcclusion,
    vectors: undefined,
  })
  needed.device = gpu.device
  needed.normals = gpu.surfaces.views()[1]
  needed.depth = depth
  needed.empty = gpu.deferred.placeholders.ambientOcclusion
  needed.vectors = velocity?.active && velocity.measured ? velocity.vectors : undefined
  return needed
}

/** What the lighting does with the occlusion this image (`DeferredLighting.setAmbientOcclusion`) in a mode that draws it:
 *  the mode's code — 1 for the scene's emission and sky light, 2 for the screen probes' light — and the share it
 *  applies at, written on the state. */
function applyOf(
  rt: WebgpuPagesRuntime,
  state: AmbientOcclusion,
  mode: Exclude<AmbientOcclusionMode, 'none'>,
) {
  state.code = mode === 'scene' ? 1 : 2
  state.amount =
    mode === 'scene'
      ? state.settings.staticFraction
      : readScreenProbeSetting(rt, 'screenProbeOcclusionIntensity')
}

/** The image drew no occlusion: the lighting is told none, whatever the texture it read last. */
function drawNone(
  state: AmbientOcclusion,
  deferred: NonNullable<WebgpuPagesRuntime['gpu']['deferred']>,
) {
  state.output = undefined
  state.code = state.amount = 0
  deferred.setAmbientOcclusion(0, 0)
}

/**
 * THE AMBIENT OCCLUSION OF THE IMAGE (`encodeAmbientOcclusion`), after the depth pyramid and before the lighting, which
 * reads the texture it leaves (`DirectLightResources.ambientOcclusion`) and applies it as the mode says
 * (`ambientOcclusionMode`: where no global illumination is on, or, asked, over the probes' light). An image the mode draws
 * nothing in — the switch off, an intensity of 0, no resolution, the bounce with the probes' own occlusion — keeps no
 * texture, makes no pass and binds nothing but the lighting's stand-in; one that cannot draw it just now — programs still
 * compiling, no depth drawn this image, the budget's refusal (not asked again until the device's room holds the view) — is lit
 * without it, its textures kept through a frame that lacks the depth. The method the settings name (`ambientOcclusionMethod`)
 * draws the passes.
 */
export function encodeAmbientOcclusion(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const deferred = gpu.deferred
  if (!deferred) return
  const state = (gpu.ambientOcclusion ??= createAmbientOcclusion())
  const values = state.watch.read(rt.context)
  if (state.watch.moved) {
    state.settings = resolveAmbientOcclusion(values)
    state.method = methodOf(state.settings, state.history)
  }
  const mode = ambientOcclusionMode(state.settings, indirectLight(rt, state.indirect))
  if (mode === 'none') {
    state.dispose()
    state.why = state.refusal = undefined
    return drawNone(state, deferred)
  }
  const { method } = state
  const inputs = neededOf(rt, state)
  if (!inputs || !method.ready(inputs.device)) return drawNone(state, deferred)
  const spec = method.spec(gpu.allocatedSize, !!gpu.temporal?.frame.active)
  const { refusal } = state
  if (refusal?.spec === spec && ledgerRoom(inputs.device) < refusal.bytes)
    return drawNone(state, deferred)
  const { view, why } = ensureAoView(state.view, inputs.device, spec)
  state.view = view
  state.why = why
  state.refusal = view ? undefined : { spec, bytes: aoViewBytes(spec) }
  if (!view) return drawNone(state, deferred)
  state.output = method.draw(encoder, view, inputs, imageOf(rt, cam, method.extent, state))
  applyOf(rt, state, mode)
  deferred.setAmbientOcclusion(state.code, state.amount)
}

/** Refills the image's words — what the passes tell of it — and notes the revision it was drawn at. */
function imageOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  extent: AoImage['extent'],
  state: AmbientOcclusion,
) {
  const { image } = state
  image.view = rt.gpu.targetSize
  image.extent = extent
  image.projection = cam.projection
  image.world = cam.world
  image.perspective = cam.perspective > 0.5
  image.noiseIndex = lightingPhase(rt)
  image.frame = rt.run.frame
  image.viewProjection = cam.viewProjection
  image.accumulates = !!rt.gpu.temporal?.frame.active
  // The camera the history's image was drawn with: the view's, where that image is the one before; a history that skipped an
  // image holds none and starts again, as after a cut.
  image.before = cameraSeen(previousCameraOf(rt), state.history.seen)
  image.historyCut =
    rt.run.gate.temporalRevision !== state.revision || (state.history.valid && !image.before)
  state.revision = rt.run.gate.temporalRevision
  return image
}

/** What the frame's metrics publish of the occlusion: which method, whether the image drew it, the bytes it holds and, where a
 *  view could not be made, the budget's reason. */
export const ambientOcclusionMetrics = (state: AmbientOcclusion | undefined) =>
  state && {
    method: state.settings.method,
    drawn: state.output !== undefined,
    bytes: state.bytes,
    why: state.why ?? null,
  }
