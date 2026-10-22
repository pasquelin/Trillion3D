import {
  AMBIENT_OCCLUSION_RULES,
  ambientOcclusionMode,
  resolveAmbientOcclusion,
  type AmbientOcclusionMode,
  type AmbientOcclusionSettings,
  type IndirectLightState,
} from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { contextReader, settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../frame/prepare/contractLight.ts'
import { fullscreenDraw } from '../../post/filters/fullscreenDraw.ts'
import { stochasticPhase } from '../../post/taa/frameState.ts'
import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { AO_BINDINGS, AO_PARAMS } from './layout.ts'
import { aoShapeOf, type AoShape } from './occlusionWgsl.ts'
import { writeAoParams, type AoImage } from './params.ts'
import { aoExtentOf, aoPasses, aoTargetRect, type AoPass } from './plan.ts'
import { aoPrograms } from './pipelines.ts'
import { ensureAoView, type AoView } from './view.ts'

/** The occlusion a view keeps: its settings read once and again when one moved, the textures it draws, and what the
 *  lighting reads this image (`output`: none where the image drew none). Held on the view's GPU state
 *  (`WebgpuGpuState.ambientOcclusion`), counted in its bytes. */
export interface AmbientOcclusion {
  readonly watch: ReturnType<typeof settingsWatch<typeof AMBIENT_OCCLUSION_RULES>>
  settings: AmbientOcclusionSettings
  /** What the image's indirect light is, read each image (`indirectLight`). */
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
  const state: AmbientOcclusion = {
    watch,
    settings: resolveAmbientOcclusion(watch.read({})),
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

const screenProbeSetting = contextReader(SCREEN_PROBE_RULES)

/**
 * What the image's indirect light is: whether the screen probes light its pixels — the bounce asked, a lit view and a
 * level that is not `'off'`, the reading the probes' own pass and the velocity stage make — and the short-range
 * occlusion's switch as written, which decides whether the probes' light is occluded here (`ambientOcclusionMode`).
 */
function indirectLight(rt: WebgpuPagesRuntime, into: IndirectLightState) {
  into.probes =
    rt.bounce.wanted &&
    wantsContractLighting(rt) &&
    screenProbeSetting(rt, 'screenProbes') !== 'off'
  into.shortRange = screenProbeSetting(rt, 'screenProbeShortRangeOcclusion')
  return into
}

/** What an image needs of the frame to draw the occlusion, or nothing while it lacks any of it: the device, the G-buffer, the
 *  depth pyramid the image drew, and a lit view. */
function neededOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt
  const depth = vis.gpuHiz?.depth()
  if (!gpu.device || !gpu.surfaces || !depth || !run.depthDrawn) return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  return { device: gpu.device, normals: gpu.surfaces.views()[1], depth }
}

/** The programs the plan of `settings` draws with, each asked of the device off the thread: whether all are ready. */
function askPrograms(
  programs: ReturnType<typeof aoPrograms>,
  passes: readonly AoPass[],
  settings: AmbientOcclusionSettings,
) {
  let ready = programs.setup.ask().ready
  for (const pass of passes)
    if (pass.kind !== 'setup') ready = programs.search(shapeOf(pass, settings)).ask().ready && ready
  return ready
}

/** The shape of the search of `pass`. */
const shapeOf = (pass: AoPass, { shaderQuality }: AmbientOcclusionSettings): AoShape =>
  aoShapeOf(pass.kind === 'final' ? 'final' : 'step', shaderQuality, !!pass.lower)

/** The groups of a view's passes, made over the depth and the normals this image reads, and kept while they are those. */
function groupsOf(
  view: AoView,
  programs: ReturnType<typeof aoPrograms>,
  passes: readonly AoPass[],
  needed: NonNullable<ReturnType<typeof neededOf>>,
  device: GPUDevice,
) {
  const held = view.groups
  if (held && held.depth === needed.depth && held.normals === needed.normals) return held.made
  const made = passes.map((pass, at) =>
    device.createBindGroup({
      label: `${AMBIENT_OCCLUSION_PASS} ${pass.target}`,
      layout: programs.layout,
      entries: [
        { binding: AO_BINDINGS.params, resource: { buffer: view.params[at] } },
        ...hizDepthBindEntries(AO_BINDINGS.depth, needed.depth),
        { binding: AO_BINDINGS.normals, resource: needed.normals },
        {
          binding: AO_BINDINGS.setup,
          resource: pass.setup ? view.textures[pass.setup]!.view : programs.emptySetup,
        },
        {
          binding: AO_BINDINGS.lower,
          resource: pass.lower ? view.textures[pass.lower]!.view : programs.emptyOcclusion,
        },
      ],
    }),
  )
  view.groups = { depth: needed.depth, normals: needed.normals, made }
  return made
}

const draw = fullscreenDraw(AMBIENT_OCCLUSION_PASS)
const words = new Float32Array(AO_PARAMS.words)

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
  near: cam.near,
  far: cam.far,
  perspective: cam.perspective > 0.5,
  noiseIndex: stochasticPhase(rt.gpu.temporal?.frame),
})

/** Draws the passes of the plan over the view's textures, each from its own uniform written for it. */
function drawPasses(
  encoder: GPUCommandEncoder,
  device: GPUDevice,
  view: AoView,
  groups: readonly GPUBindGroup[],
  plan: { passes: readonly AoPass[]; programs: ReturnType<typeof aoPrograms> },
  settings: AmbientOcclusionSettings,
  image: AoImage,
) {
  const { passes, programs } = plan
  passes.forEach((pass, at) => {
    writeAoParams(words, pass, settings, image)
    device.queue.writeBuffer(view.params[at], 0, words)
    const pipeline =
      pass.kind === 'setup' ? programs.setup.get() : programs.search(shapeOf(pass, settings)).get()
    draw(
      encoder,
      view.textures[pass.target]!.view,
      pipeline,
      groups[at],
      undefined,
      aoTargetRect(pass.target, image.view),
    )
  })
}

/** What the lighting does with the occlusion this image (`DeferredLighting.setAmbientOcclusion`): the mode's code — 0 none,
 *  1 for the scene's emission and sky light, 2 for the screen probes' light — and the share it applies at. */
function applyOf(rt: WebgpuPagesRuntime, state: AmbientOcclusion, mode: AmbientOcclusionMode) {
  if (mode === 'none' || !state.output) return [0, 0] as const
  return mode === 'scene'
    ? ([1, state.settings.staticFraction] as const)
    : ([2, screenProbeSetting(rt, 'screenProbeOcclusionIntensity')] as const)
}

/**
 * THE AMBIENT OCCLUSION OF THE IMAGE (`encodeAmbientOcclusion`), after the depth pyramid and before the lighting, which
 * reads the texture it leaves (`DirectLightResources.ambientOcclusion`) and applies it as the mode says
 * (`ambientOcclusionMode`: where no screen probes light the pixels, or, asked, over theirs). An image the mode draws
 * nothing in — the switch off, an intensity of 0, no resolution, screen probes with their own occlusion — keeps no
 * texture, makes no pass and binds nothing but the lighting's stand-in; one that cannot draw it yet — programs still
 * compiling, no depth drawn, the budget's refusal — is lit without it.
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
  if (state.watch.moved) state.settings = resolveAmbientOcclusion(values)
  const { settings } = state
  const mode = ambientOcclusionMode(settings, indirectLight(rt, state.indirect))
  state.output = undefined
  const needed = mode === 'none' ? undefined : neededOf(rt)
  if (!needed) {
    state.dispose()
    return deferred.setAmbientOcclusion(0, 0)
  }
  const programs = aoPrograms(needed.device)
  const passes = aoPasses(settings.levels)
  if (!askPrograms(programs, passes, settings)) return deferred.setAmbientOcclusion(0, 0)
  const extent = aoExtentOf(gpu.allocatedSize)
  const { view } = ensureAoView(state.view, needed.device, settings.levels, extent)
  state.view = view
  if (!view) return deferred.setAmbientOcclusion(0, 0)
  const groups = groupsOf(view, programs, passes, needed, needed.device)
  drawPasses(
    encoder,
    needed.device,
    view,
    groups,
    { passes, programs },
    settings,
    imageOf(rt, cam, extent),
  )
  state.output = view.textures.ao!.view
  deferred.setAmbientOcclusion(...applyOf(rt, state, mode))
}
