import {
  SUBSURFACE_SCATTERING_RULES,
  resolveSubsurfaceScattering,
  subsurfaceCheckerboardOn,
  type SubsurfaceScatteringSettings,
} from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { SubsurfaceProfile } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  cameraSeen,
  NEVER_SEEN,
  previousCameraOf,
} from '../../frame/backend/state/previousCamera.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import { ledgerRoom } from '../../gpu/core/deviceLedger.ts'
import type { Velocity } from '../../post/taa/velocity.ts'
import { lightingPhase } from '../surfaceCache/lighting/phase.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { encodeKernels, drawRecombine } from './encode.ts'
import {
  subsurfaceGroups,
  historyState,
  type SubsurfaceGroups,
  type SubsurfaceNeeded,
} from './groups.ts'
import { writeSubsurfaceParams, type SubsurfaceImage } from './params.ts'
import {
  subOf,
  subsurfaceShapeOf,
  subsurfaceSpecOf,
  subsurfaceTilesOf,
  type SubsurfaceViewSpec,
} from './plan.ts'
import { subsurfacePrograms, subsurfaceReady, type ShapePipelines } from './pipelines.ts'
import type { SubsurfaceShape } from './shape.ts'
import { createProfileTable, type ProfileTable } from './table.ts'
import { ensureSubsurfaceView, subsurfaceViewBytes, type SubsurfaceView } from './view.ts'
import { SSS_PARAMS } from './layout.ts'
import { createSubsurfaceDebugPixel } from './debugPixel.ts'
import { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import { readSetting } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { MODEL_SWITCH } from '../../materials/surface/pixelModel.ts'
import { registeredSubsurfaceProfiles } from './registry.ts'

/** What the settings, the accumulation and the targets' size decide: the shape of the programs, the spec of the view and the pipelines of
 *  the shape, made again only when one of the four moves. */
interface SubsurfacePlan {
  settings: SubsurfaceScatteringSettings
  accumulates: boolean
  allocated: readonly [number, number]
  programs: ReturnType<typeof subsurfacePrograms>
  shape: SubsurfaceShape
  spec: SubsurfaceViewSpec
  pipelines: ShapePipelines
}

/**
 * A VIEW'S SUBSURFACE SCATTERING: its settings read again when one moved, the profiles its materials name and the table they make on
 * the GPU, its textures and buffers, and what the quality history of the sampled scattering keeps from one image to the next — which of
 * its pair was written last, whether it holds an image, and the number of that image. Held on the view's GPU state
 * (`WebgpuGpuState.subsurface`), counted in its bytes.
 */
export interface SubsurfaceScattering {
  readonly watch: ReturnType<typeof settingsWatch<typeof SUBSURFACE_SCATTERING_RULES>>
  settings: SubsurfaceScatteringSettings
  profiles: readonly SubsurfaceProfile[]
  profilesRevision: number
  /** The collection of the materials' profiles (`registeredSubsurfaceProfiles`) the profiles were last taken from. */
  registeredRevision: number
  table: ProfileTable | undefined
  view: SubsurfaceView | undefined
  needed: SubsurfaceNeeded | undefined
  plan: SubsurfacePlan | undefined
  /** The history's texture written last (the next image reads it), whether it holds an image, the image it was drawn at and the
   *  temporal revision. */
  written: 0 | 1
  valid: boolean
  seen: number
  revision: number
  refusal: { key: string; bytes: number } | undefined
  why: string | undefined
  drawn: boolean
  /** The groups of the last image drawn, which the debug views draw over (`visualize.ts`). */
  groups: SubsurfaceGroups | undefined
  /** The reading of the pixel under the debug cursor (`subsurfaceDebugPixel`), made when it is first asked. */
  pixel: ReturnType<typeof createSubsurfaceDebugPixel> | undefined
  readonly words: Float32Array<ArrayBuffer>
  bytes: number
  dispose(): void
}

function createSubsurfaceScattering(): SubsurfaceScattering {
  const watch = settingsWatch(SUBSURFACE_SCATTERING_RULES)
  const state: SubsurfaceScattering = {
    watch,
    settings: resolveSubsurfaceScattering(watch.read({})),
    profiles: [],
    profilesRevision: 0,
    registeredRevision: -1,
    table: undefined,
    view: undefined,
    needed: undefined,
    plan: undefined,
    written: 0,
    valid: false,
    seen: NEVER_SEEN,
    revision: -1,
    refusal: undefined,
    why: undefined,
    drawn: false,
    groups: undefined,
    pixel: undefined,
    words: new Float32Array(new ArrayBuffer(SSS_PARAMS.words * 4)),
    bytes: 0,
    dispose() {
      state.view?.dispose()
      state.table?.destroy()
      state.view = state.table = undefined
      state.pixel?.dispose()
      state.pixel = undefined
      state.groups = undefined
      state.valid = false
      state.bytes = 0
    },
  }
  return state
}

/** The state of the view, made at the first ask. */
const subsurfaceOf = (rt: WebgpuPagesRuntime) =>
  (rt.gpu.subsurface ??= createSubsurfaceScattering())

/** Sets the profiles the materials name (row 0 of the table is always the default skin's, a pixel's profile 1 the first of them);
 *  at most 255. The next image makes the table again. */
function setSubsurfaceProfiles(rt: WebgpuPagesRuntime, profiles: readonly SubsurfaceProfile[]) {
  const state = subsurfaceOf(rt)
  if (profiles.length > 255) throw new RangeError('at most 255 subsurface profiles')
  state.profiles = profiles
  state.profilesRevision++
}

/** Hands the view the profiles the materials name, when they are new since it last took them. */
export function followRegisteredProfiles(rt: WebgpuPagesRuntime) {
  const state = subsurfaceOf(rt)
  const held = registeredSubsurfaceProfiles()
  if (state.registeredRevision === held.revision) return
  state.registeredRevision = held.revision
  setSubsurfaceProfiles(rt, held.profiles.slice())
}

/** The plan of the image, the one held while its four decisions stand. */
function planOf(
  state: SubsurfaceScattering,
  programs: ReturnType<typeof subsurfacePrograms>,
  allocated: readonly [number, number],
  accumulates: boolean,
) {
  const held = state.plan
  const { settings } = state
  if (
    held &&
    held.settings === settings &&
    held.accumulates === accumulates &&
    held.programs === programs &&
    held.allocated[0] === allocated[0] &&
    held.allocated[1] === allocated[1]
  )
    return held
  const shape = subsurfaceShapeOf(settings, accumulates)
  return (state.plan = {
    settings,
    accumulates,
    allocated,
    programs,
    shape,
    spec: subsurfaceSpecOf(shape, allocated, programs.tier1),
    pipelines: programs.shapes.of(shape),
  })
}

/** What an image needs of the frame, or nothing while it lacks any of it: the device, the G-buffer with the data of a profile pixel,
 *  the depth pyramid the image drew and a lit view. */
function neededOf(rt: WebgpuPagesRuntime, state: SubsurfaceScattering, table: ProfileTable) {
  const { gpu, vis, run } = rt
  const depth = vis.gpuHiz?.depth()
  const surfaces = gpu.surfaces
  if (!gpu.device || !surfaces?.hasSubsurface || !gpu.hdrView || !depth || !run.depthDrawn)
    return undefined
  if (!wantsContractLighting(rt) || !drawsLit(run.diagnostic)) return undefined
  const views = surfaces.views()
  const velocity = gpu.velocity
  const needed = (state.needed ??= {} as SubsurfaceNeeded)
  needed.device = gpu.device
  needed.color = gpu.hdrView
  needed.normals = views[1]
  needed.base = views[0]
  needed.flags = views[3]
  needed.data = surfaces.subsurfaceView
  needed.depth = depth
  needed.table = table.view
  needed.vectors = velocity && hasMeasuredVectors(velocity) ? velocity.vectors : undefined
  return needed
}

/** Whether the velocity pass is on and measured the vectors of this image. */
const hasMeasuredVectors = (velocity: Velocity) => velocity.active && velocity.measured

/** The image's words, refilled. */
const image: SubsurfaceImage = {
  drawn: [1, 1],
  allocated: [1, 1],
  sub: [1, 1],
  subDrawn: [1, 1],
  tiles: [1, 1],
  mips: 1,
  projection: [],
  perspective: true,
  viewProjection: [],
  before: undefined,
  frame: 0,
  jitter: [0, 0],
  vectors: false,
  historyValid: false,
}

/** The profile table, made again when the profiles or the sampling channel changed; the one held. */
function refreshProfileTable(device: GPUDevice, state: SubsurfaceScattering) {
  const { samplingChannel } = state.settings
  if (
    state.table &&
    state.table.revision === state.profilesRevision &&
    state.table.samplingChannel === samplingChannel
  )
    return state.table
  state.table?.destroy()
  return (state.table = createProfileTable(
    device,
    state.profiles,
    state.profilesRevision,
    samplingChannel,
  ))
}

/**
 * THE SCREEN-SPACE SUBSURFACE SCATTERING OF THE IMAGE (`encodeSubsurfaceScattering`), after the lighting and before the sky, the fog
 * and the transparents: the lit image rewritten at the pixels of the subsurface-profile model by their scattered diffuse light.
 * 1. The tiles that hold such a pixel are found and listed (`sssMark`, `sssLists`, `sssArgsTiles`); the setup (`sssSetupMain`,
 *    `sssSetupPass`) writes their diffuse light, depth and profile at the scattering's resolution and lists the tiles by how they scatter
 *    (`sssArgsScatter`); the mip chain of the diffuse light is made when enough tiles scatter by sampling.
 * 2. The sampled scattering (`sssSampledScatter`) and the separable scattering along each axis (`sssSeparableHorizontal`,
 *    `sssSeparableVertical`), then the variance update of the sampled one (`sssVariance`), leave the scattered light.
 * 3. The recombine draws the lighting rebuilt over the tiles (`sssRecombine`) into an image of its own and the copy writes it back
 *    onto the lit image (`sssCopy`).
 * Every dispatch and draw but the classification's and the setup's is indirect, sized by the counts the pass itself made: an image with
 * no pixel of the model scatters nothing. An image the pass cannot draw just now — programs still compiling, the budget's refusal,
 * the surfaces without data — is left as lit.
 */
export function encodeSubsurfaceScattering(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, run } = rt
  const state = subsurfaceOf(rt)
  const values = state.watch.read(rt.context)
  if (state.watch.moved) state.settings = resolveSubsurfaceScattering(values)
  state.drawn = false
  const device = gpu.device
  if (!device || !state.settings.enabled || !gpu.surfaces?.hasSubsurface) {
    if (state.view) state.dispose()
    return
  }
  const needed = neededOf(rt, state, refreshProfileTable(device, state))
  const programs = subsurfacePrograms(device)
  const { shape, spec, pipelines } = planOf(
    state,
    programs,
    gpu.allocatedSize,
    !!gpu.temporal?.frame.active,
  )
  if (!needed || !subsurfaceReady(shape, pipelines)) return
  if (state.refusal?.key === spec.key && ledgerRoom(device) < state.refusal.bytes) return
  const made = ensureSubsurfaceView(state.view, device, spec)
  state.view = made.view
  state.why = made.why
  state.refusal = made.view ? undefined : { key: spec.key, bytes: subsurfaceViewBytes(spec) }
  const view = made.view
  if (!view) return
  state.bytes = view.bytes + (state.table?.bytes ?? 0)
  fillImage(rt, state, cam, shape.half, spec.sub, spec.mips)
  writeSubsurfaceParams(
    state.words,
    state.settings,
    shape.checker && state.settings.neighborValidation,
    image,
  )
  device.queue.writeBuffer(view.buffers.params, 0, state.words)
  const groups = subsurfaceGroups(view, programs, needed)
  state.groups = groups
  encoder.clearBuffer(view.buffers.counts)
  encoder.clearBuffer(view.buffers.masks)
  const written = state.valid ? ((1 - state.written) as 0 | 1) : 0
  encodeKernels(encoder, view, groups, pipelines, shape, historyState(state.valid, written), image)
  if (state.settings.debugPixel && !shape.half) {
    // The pixel under the debug cursor (the middle of the image where none is set), read before the recombine rewrites the lit image.
    const cursor = (
      field: 'sampledLightsDebugCursorX' | 'sampledLightsDebugCursorY',
      size: number,
    ) => {
      const value = readSetting(SAMPLED_LIGHTS_RULES, rt.context, field)
      return Math.min(value >= 0 ? value : Math.floor(size / 2), size - 1)
    }
    const pixel = (state.pixel ??= createSubsurfaceDebugPixel(device))
    pixel.encode(
      encoder,
      run.frame,
      shape,
      groups.common,
      needed.color,
      view.textures.pass2,
      cursor('sampledLightsDebugCursorX', gpu.targetSize[0]),
      cursor('sampledLightsDebugCursorY', gpu.targetSize[1]),
    )
  }
  drawRecombine(encoder, view, groups, pipelines, gpu.hdrView!)
  if (!shape.forceSeparable) {
    state.written = written
    state.valid = true
    state.seen = run.frame
  }
  state.drawn = true
}

/** Refills the image's words and notes the revision of the temporal state this image was drawn at (a cut drops the history). */
function fillImage(
  rt: WebgpuPagesRuntime,
  state: SubsurfaceScattering,
  cam: EngineCamera,
  half: boolean,
  sub: readonly [number, number],
  mips: number,
) {
  const { gpu, run } = rt
  const taa = gpu.temporal?.frame
  image.drawn = gpu.targetSize
  image.allocated = gpu.allocatedSize
  image.sub = sub
  subOf(gpu.targetSize, half, image.subDrawn)
  subsurfaceTilesOf(gpu.targetSize, half, image.tiles)
  image.mips = mips
  image.projection = cam.projection
  image.perspective = cam.perspective > 0.5
  image.viewProjection = cam.viewProjection
  const before = cameraSeen(previousCameraOf(rt), state.seen)
  image.before = before?.viewProjection
  image.frame = lightingPhase(rt)
  image.jitter[0] = taa?.active ? taa.jitter[0] : 0
  image.jitter[1] = taa?.active ? taa.jitter[1] : 0
  image.vectors = !!gpu.velocity && hasMeasuredVectors(gpu.velocity)
  if (run.gate.temporalRevision !== state.revision || (state.valid && !before)) state.valid = false
  state.revision = run.gate.temporalRevision
  image.historyValid = state.valid
}

/** The switches the lighting's view uniform holds of the pass this image (`MODEL_SWITCH`). */
export function subsurfaceSwitches(rt: WebgpuPagesRuntime) {
  const { postprocess, checkerboard } = subsurfaceLitState(rt)
  return (
    (postprocess ? MODEL_SWITCH.subsurfaceScattering : 0) |
    (checkerboard ? MODEL_SWITCH.subsurfaceCheckerboard : 0)
  )
}

/** The distance at which the colour of a surface of the subsurface model is read as the light's transmittance (the lighting's view
 *  uniform holds it). */
export const subsurfaceTransmittanceDistance = (rt: WebgpuPagesRuntime) =>
  subsurfaceOf(rt).settings.colorTransmittanceDistance

/** What the lighting asks of the pass this image (`SSS_LIT_WGSL`): whether it runs — the lit image's alpha is then the diffuse light's
 *  luminance — and whether the lit image holds the checkerboard. */
function subsurfaceLitState(rt: WebgpuPagesRuntime) {
  const state = subsurfaceOf(rt)
  const postprocess = !!rt.gpu.surfaces?.hasSubsurface && state.settings.enabled
  return { postprocess, checkerboard: postprocess && subsurfaceCheckerboardOn(state.settings) }
}

/** What the debug views of the subsurface scattering draw from: the groups of the last image the pass drew, none if it drew none this image, with the profiles and the settings. */
export function subsurfaceDebugSource(rt: WebgpuPagesRuntime) {
  const state = rt.gpu.subsurface
  return state?.drawn && state.groups
    ? {
        groups: state.groups,
        profiles: state.profiles,
        settings: state.settings,
        pixel: state.pixel,
      }
    : undefined
}

/** Requests mapping of the pixel reading, once the frame that copied it is submitted. */
export const subsurfaceDebugSubmitted = (rt: { gpu: WebgpuPagesRuntime['gpu'] }) =>
  rt.gpu.subsurface?.pixel?.submitted()
