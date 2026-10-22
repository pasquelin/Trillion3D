import {
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
  type AmbientOcclusionMode,
  type AmbientOcclusionSettings,
  type IndirectLightState,
} from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../frame/prepare/contractLight.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { fullscreenDraw } from '../../post/filters/fullscreenDraw.ts'
import { stochasticPhase } from '../../post/taa/frameState.ts'
import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { screenProbeSetting, screenProbesCast } from '../bounce/screen/cast.ts'
import { AO_BINDINGS, AO_PARAMS } from './layout.ts'
import { aoShapeOf, type AoShape } from './occlusionWgsl.ts'
import { writeAoParams, type AoImage } from './params.ts'
import { AO_HALF_DEPTH, aoExtentOf, aoPasses, aoTargetRect, type AoPass } from './plan.ts'
import { aoPrograms } from './pipelines.ts'
import { ensureAoView, type AoView } from './view.ts'

/** The passes of a view's settings and the program shape of each search among them (none for a setup), made once while
 *  the settings hold. */
interface AoPlan {
  passes: readonly AoPass[]
  shapes: readonly (AoShape | undefined)[]
}

/** The plan of `settings`' resolutions and shader quality. */
function planOf({ levels, shaderQuality }: AmbientOcclusionSettings): AoPlan {
  const passes = aoPasses(levels)
  const shapes = passes.map((pass) =>
    pass.kind === 'setup' ? undefined : aoShapeOf(pass.kind, shaderQuality, !!pass.lower),
  )
  return { passes, shapes }
}

/** The occlusion a view keeps: its settings read once and again when one moved, the plan they make, the textures it draws,
 *  and what the lighting reads this image (`output`: none where the image drew none). Held on the view's GPU state
 *  (`WebgpuGpuState.ambientOcclusion`), counted in its bytes. */
export interface AmbientOcclusion {
  readonly watch: ReturnType<typeof settingsWatch<typeof AMBIENT_OCCLUSION_RULES>>
  settings: AmbientOcclusionSettings
  plan: AoPlan
  /** What the image's indirect light is, read each image (`indirectLight`) into this one object: none is made a frame. */
  readonly indirect: IndirectLightState
  view: AoView | undefined
  output: GPUTextureView | undefined
  /** Bytes the textures hold. */
  readonly bytes: number
  /** Gives the textures back. */
  dispose(): void
}

/** An occlusion with nothing drawn yet. */
export function createAmbientOcclusion(): AmbientOcclusion {
  const watch = settingsWatch(AMBIENT_OCCLUSION_RULES)
  const settings = resolveAmbientOcclusion(watch.read({}))
  const state: AmbientOcclusion = {
    watch,
    settings,
    plan: planOf(settings),
    indirect: { probes: false, shortRange: true },
    view: undefined,
    output: undefined,
    get bytes() {
      return state.view?.bytes ?? 0
    },
    dispose() {
      state.view?.dispose()
      state.view = state.output = undefined
    },
  }
  return state
}

/**
 * What the image's indirect light is: whether the screen probes light its pixels (`screenProbesCast`, the one reading of
 * that rule) and the short-range occlusion's switch as written, which decides whether the probes' light is occluded
 * here (`ambientOcclusionMode`).
 */
function indirectLight(rt: WebgpuPagesRuntime, into: IndirectLightState) {
  into.probes = screenProbesCast(rt)
  into.shortRange = screenProbeSetting(rt, 'screenProbeShortRangeOcclusion')
  return into
}

/** What an image needs of the frame to draw the occlusion, or nothing while it lacks any of it: the device, the G-buffer, the
 *  depth pyramid the image drew, a lit view and the lighting's stand-in. */
function neededOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt
  const depth = vis.gpuHiz?.depth()
  if (!gpu.device || !gpu.surfaces || !gpu.deferred || !depth || !run.depthDrawn) return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  return {
    device: gpu.device,
    normals: gpu.surfaces.views()[1],
    depth,
    empty: gpu.deferred.placeholders.ambientOcclusion,
  }
}

/** The programs the plan draws with, each asked of the device off the thread: whether all are ready. */
function askPrograms(programs: ReturnType<typeof aoPrograms>, { shapes }: AoPlan) {
  let ready = programs.setup.ask().ready
  for (const shape of shapes) if (shape) ready = programs.search(shape).ask().ready && ready
  return ready
}

/** The groups of a view's passes, made over the depth, the normals and the stand-in this image reads, and kept while they are
 *  those. A search reads the half-size depth map (`AO_HALF_DEPTH`); a setup, which draws it, a stand-in. */
function groupsOf(
  view: AoView,
  programs: ReturnType<typeof aoPrograms>,
  passes: readonly AoPass[],
  needed: NonNullable<ReturnType<typeof neededOf>>,
) {
  const key = [needed.depth, needed.normals, needed.empty]
  const held = view.groups
  if (held && key.every((resource, i) => resource === held.key[i])) return held.made
  const { device, depth, normals, empty } = needed
  const made = passes.map((pass, at) =>
    device.createBindGroup({
      label: `${AMBIENT_OCCLUSION_PASS} ${pass.target}`,
      layout: programs.layout,
      entries: [
        { binding: AO_BINDINGS.params, resource: { buffer: view.params[at] } },
        ...hizDepthBindEntries(AO_BINDINGS.depth, depth),
        { binding: AO_BINDINGS.normals, resource: normals },
        {
          binding: AO_BINDINGS.half,
          resource: pass.kind === 'setup' ? programs.emptySetup : view.textures[AO_HALF_DEPTH]!,
        },
        {
          binding: AO_BINDINGS.setup,
          resource: pass.setup ? view.textures[pass.setup]! : programs.emptySetup,
        },
        {
          binding: AO_BINDINGS.lower,
          resource: pass.lower ? view.textures[pass.lower]! : empty,
        },
      ],
    }),
  )
  view.groups = { key, made }
  return made
}

const draw = fullscreenDraw(AMBIENT_OCCLUSION_PASS)
const words = new Float32Array(AO_PARAMS.words)
const sent = new Uint32Array(words.buffer)

/** What the image tells the passes (`AoImage`), from the camera and the frame's targets. */
const imageOf = (
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  extent: readonly [number, number],
): AoImage => ({
  view: rt.gpu.targetSize,
  extent,
  projection: cam.projection,
  world: cam.world,
  perspective: cam.perspective > 0.5,
  noiseIndex: stochasticPhase(rt.gpu.temporal?.frame),
})

/** Draws the passes of the plan over the view's textures, each from its own uniform: the words that moved go up. */
function drawPasses(
  encoder: GPUCommandEncoder,
  view: AoView,
  groups: readonly GPUBindGroup[],
  plan: AoPlan,
  programs: ReturnType<typeof aoPrograms>,
  settings: AmbientOcclusionSettings,
  image: AoImage,
) {
  const { passes, shapes } = plan
  const { device } = programs
  passes.forEach((pass, at) => {
    writeAoParams(words, pass, settings, image)
    writeChanged(device, view.params[at], sent, 0, AO_PARAMS.words)
    const shape = shapes[at]
    const pipeline = shape ? programs.search(shape).get() : programs.setup.get()
    draw(
      encoder,
      view.textures[pass.target]!,
      pipeline,
      groups[at],
      undefined,
      aoTargetRect(pass.target, image.view),
    )
  })
}

/** What the lighting does with the occlusion this image (`DeferredLighting.setAmbientOcclusion`) in a mode that draws it:
 *  the mode's code — 1 for the scene's emission and sky light, 2 for the screen probes' light — and the share it
 *  applies at. */
function applyOf(
  rt: WebgpuPagesRuntime,
  settings: AmbientOcclusionSettings,
  mode: AmbientOcclusionMode,
) {
  return mode === 'scene'
    ? ([1, settings.staticFraction] as const)
    : ([2, screenProbeSetting(rt, 'screenProbeOcclusionIntensity')] as const)
}

/**
 * THE AMBIENT OCCLUSION OF THE IMAGE (`encodeAmbientOcclusion`), after the depth pyramid and before the lighting, which
 * reads the texture it leaves (`DirectLightResources.ambientOcclusion`) and applies it as the mode says
 * (`ambientOcclusionMode`: where no screen probes light the pixels, or, asked, over theirs). An image the mode draws
 * nothing in — the switch off, an intensity of 0, no resolution, screen probes with their own occlusion — keeps no
 * texture, makes no pass and binds nothing but the lighting's stand-in; one that cannot draw it just now — programs still
 * compiling, no depth drawn this image, the budget's refusal — is lit without it, its textures kept through a frame
 * that lacks the depth.
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
    state.plan = planOf(state.settings)
  }
  const { settings, plan } = state
  const none = () => {
    state.output = undefined
    deferred.setAmbientOcclusion(0, 0)
  }
  const mode = ambientOcclusionMode(settings, indirectLight(rt, state.indirect))
  if (mode === 'none') {
    state.dispose()
    return none()
  }
  const needed = neededOf(rt)
  const programs = needed && aoPrograms(needed.device)
  if (!needed || !programs || !askPrograms(programs, plan)) return none()
  const extent = aoExtentOf(gpu.allocatedSize)
  const view = (state.view = ensureAoView(state.view, needed.device, settings.levels, extent))
  if (!view) return none()
  const groups = groupsOf(view, programs, plan.passes, needed)
  drawPasses(encoder, view, groups, plan, programs, settings, imageOf(rt, cam, extent))
  state.output = view.textures.ao
  deferred.setAmbientOcclusion(...applyOf(rt, settings, mode))
}
