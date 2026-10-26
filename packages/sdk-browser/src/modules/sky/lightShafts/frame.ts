import { settingsWatch } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { SettingValues } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { IMAGE_EFFECTS_RULES } from '../../../../../sdk-core/src/modules/sky/qualityLight.ts'
import { lightShaftOf } from '../../../../../sdk-core/src/scene/light/lightShafts.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { LIGHT_BUFFER_AT } from '../../../frame/backend/state/lightBufferLayout.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { litImageShown } from '../../../frame/prepare/contractLight.ts'
import { previousCameraOf } from '../../../frame/backend/state/previousCamera.ts'
import { preExposureOf } from '../../../post/exposure/pre.ts'
import { taaRenderMatrix, taaRenderProjection } from '../../../post/taa/frame.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'
import { budgetRefused } from '../../../gpu/core/deviceLedger.ts'
import { createLightShaftDraw, type LightShaftDraw } from './draw.ts'
import { lightShaftOrigin } from './layout.ts'
import {
  LIGHT_SHAFT_MASK_BLOCK_AT,
  LIGHT_SHAFT_MASK_FLOATS,
  writeLightShaftMaskSlots,
} from './mask.ts'
import { planLightShafts, type LightShaftChain, type LightShaftLightInput } from './plan.ts'
import { lightShaftPrograms } from './programs.ts'
import { drawLightShaftChain, type LightShaftFrame } from './run.ts'
import {
  createLightShaftTargets,
  type LightShaftImages,
  type LightShaftTargets,
} from './targets.ts'
import { shaftTemporal } from './temporal.ts'

/** What a view keeps of its light shafts (`WebgpuGpuState.lightShafts`): the settings it watches, the
 *  images and histories the chains draw with, the draws, the plan and frame of this image, and the
 *  mask the fog reads (`contractLight.ts`): none while the image drew none. */
export interface LightShaftsGpu {
  readonly watch: ReturnType<typeof settingsWatch<typeof IMAGE_EFFECTS_RULES>>
  readonly targets: LightShaftTargets
  readonly draw: LightShaftDraw
  /** This image's lights and frame, none where the shafts do not run. */
  image?: LightShaftImage
  mask?: GPUTextureView
  readonly bytes: number
  dispose(): void
}

/** The lights this image draws shafts for, in the order the store holds them, and the plan of the
 *  chains made from them. */
interface LightShaftImage {
  readonly frame: LightShaftFrame
  readonly plan: ReturnType<typeof planLightShafts>
  readonly lights: readonly LightShaftLightInput[]
  readonly ids: readonly string[]
}

type ImageEffects = SettingValues<typeof IMAGE_EFFECTS_RULES>

/** A view's light shafts with nothing drawn yet, on `device`. */
function createLightShafts(device: GPUDevice): LightShaftsGpu {
  const targets = createLightShaftTargets(device)
  const state: LightShaftsGpu = {
    watch: settingsWatch(IMAGE_EFFECTS_RULES),
    targets,
    draw: createLightShaftDraw(device),
    get bytes() {
      return targets.bytes
    },
    dispose() {
      targets.dispose()
      state.image = state.mask = undefined
    },
  }
  return state
}

const projection = new Float64Array(16)
const maskWords = new Float32Array(LIGHT_SHAFT_MASK_FLOATS)

/** Whether this image can draw shafts: a lit view that keeps them (`ViewOverrides.lightShafts`),
 *  its lit image and depth drawn. */
function runsIn(rt: WebgpuPagesRuntime) {
  const { gpu, run, views } = rt
  const { overrides } = views.active
  return (
    !!gpu.device &&
    !!gpu.hdrView &&
    !!gpu.depthView &&
    run.depthDrawn &&
    overrides.lightShafts &&
    overrides.lighting &&
    litImageShown(rt) &&
    drawsLit(run.diagnostic)
  )
}

/** The directional lights that ask for shafts, with where each stands in the view. */
function lightsOf(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { store } = rt.lights
  const matrix = taaRenderMatrix(rt, cam)
  const view = { width: rt.gpu.targetSize[0], height: rt.gpu.targetSize[1] }
  const lights: LightShaftLightInput[] = []
  const ids: string[] = []
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    if (light?.kind !== 'directional') continue
    const settings = lightShaftOf(light)
    if (!settings.shaftOcclusion && !settings.shaftBloom) continue
    const direction = light.direction ?? [0, -1, 0]
    lights.push({ settings, origin: lightShaftOrigin(matrix, cam.eye, settings, direction, view) })
    ids.push(light.id)
  }
  return { lights, ids }
}

/** The key of the history a chain filters over time with: the view's for the occlusion, the light's
 *  own for a bloom. None for a chain that is not filtered. */
function historyKeyOf(chain: LightShaftChain, ids: readonly string[]) {
  if (!chain.steps.some((step) => step.kind === 'temporal')) return undefined
  return chain.technique === 'occlusion' ? 'occlusion' : ids[chain.light]
}

/** The programs the chains of `plan` draw with, asked of the device: whether all are compiled. */
function programsReady(
  programs: ReturnType<typeof lightShaftPrograms>,
  chains: readonly LightShaftChain[],
) {
  const names = new Set<Parameters<typeof programs.ready>[0][number]>()
  for (const chain of chains)
    for (const step of chain.steps) names.add(step.kind === 'pass' ? step.pass : 'temporal')
  return programs.ready([...names])
}

/** What the image is drawn with where its shafts run: the plan of its chains, and the frame they are
 *  drawn in; none where no chain is planned, the programs are not compiled or the memory budget
 *  refuses the images. */
function imageOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  state: LightShaftsGpu,
  quality: ImageEffects,
  { lights, ids }: ReturnType<typeof lightsOf>,
): LightShaftImage | undefined {
  const { gpu } = rt
  const environment = rt.lights.store.environment
  const plan = planLightShafts({
    quality,
    allocated: { width: gpu.allocatedSize[0], height: gpu.allocatedSize[1] },
    view: { width: gpu.targetSize[0], height: gpu.targetSize[1] },
    lights,
    temporal: !!gpu.temporal?.frame.active,
  })
  // The mask is read by the fog and the haze alone: with neither, nothing is drawn for it.
  const occlusion = environment?.fog || environment?.atmosphere ? plan.occlusion : []
  const chains = [...occlusion, ...plan.bloom]
  const programs = lightShaftPrograms(device)
  if (!chains.length || !programsReady(programs, chains)) return undefined
  // The images and the histories are made where the device's memory budget leaves room.
  let images: LightShaftImages
  try {
    images = state.targets.imagesFor(plan.sizes)
    for (const chain of chains) {
      const key = historyKeyOf(chain, ids)
      if (key) state.targets.history(key, plan.sizes)
    }
  } catch (error) {
    if (budgetRefused(error)) return undefined
    throw error
  }
  const pre = preExposureOf(rt)
  const frame: LightShaftFrame = {
    encoder,
    programs,
    targets: state.targets,
    draw: state.draw,
    images,
    sizes: plan.sizes,
    lit: gpu.hdrView!,
    depth: gpu.depthView!,
    quality,
    projection: taaRenderProjection(rt, cam, projection),
    exposure: pre.shown,
    cameras: { frame: rt.run.frame, before: previousCameraOf(rt) },
    temporal: shaftTemporal(gpu.temporal, cam, pre),
  }
  return { frame, plan: { ...plan, occlusion }, lights, ids }
}

/**
 * The light shafts' occlusion of the image (`encodeLightShaftOcclusion`), drawn before the lighting
 * resolve lays the fog: for each directional light in front of the eye that asks for it, a chain
 * ends in the one mask the fog's inscattering is multiplied by (`lightShaftMask`,
 * `../../../lighting/fog/readWgsl.ts`), the last light's remaining; the bounds of its reads are
 * written into the fog's view block. Opens the image's shafts: its plan serves the bloom
 * (`encodeLightShaftBloom`) too. An image that draws none leaves the fog unmasked.
 */
export function encodeLightShaftOcclusion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const state = gpu.lightShafts
  if (state) state.image = state.mask = undefined
  if (!runsIn(rt)) return state?.dispose()
  // The sun of the sky module is a light like another, carrying its shaft fields (`SunPart.shafts`):
  // with no light asking for shafts, nothing is made, planned or encoded.
  const asking = lightsOf(rt, cam)
  if (!asking.lights.length) return state?.dispose()
  const held = (gpu.lightShafts ??= createLightShafts(device))
  const quality = held.watch.read(rt.context)
  if (!quality.lightShafts) return held.dispose()
  held.targets.begin()
  const image = (held.image = imageOf(rt, device, encoder, cam, held, quality, asking))
  if (!image) return
  let loadMask = false
  for (const chain of image.plan.occlusion) {
    const key = historyKeyOf(chain, image.ids)
    const history = key ? held.targets.history(key, image.plan.sizes) : undefined
    drawLightShaftChain(image.frame, chain, image.lights[chain.light], history, loadMask)
    loadMask = true
  }
  const buffer = rt.lights.buffer
  if (!loadMask || !buffer) return
  held.mask = image.frame.images.mask
  device.queue.writeBuffer(
    buffer,
    LIGHT_BUFFER_AT.fogView + LIGHT_SHAFT_MASK_BLOCK_AT,
    writeLightShaftMaskSlots(maskWords, image.plan.sizes),
  )
}

/**
 * The light shafts' bloom of the image (`encodeLightShaftBloom`), drawn after the translucent
 * surfaces and before the temporal pass reads the lit image: for each directional light in front of
 * the eye that asks for it, a chain ends added onto the lit image. A light's bloom is filtered over
 * time with a history of its own, which a light gone from the scene takes with it. The image the
 * shafts are drawn in is the lit image: this engine draws no translucency apart from it, which is
 * the only other image the reference's switch (off by default) could send them to.
 */
export function encodeLightShaftBloom(rt: WebgpuPagesRuntime) {
  const state = rt.gpu.lightShafts
  const image = state?.image
  if (!state || !image) return
  state.targets.keepHistories(new Set(image.ids))
  for (const chain of image.plan.bloom) {
    const key = historyKeyOf(chain, image.ids)
    const history = key ? state.targets.history(key, image.plan.sizes) : undefined
    drawLightShaftChain(image.frame, chain, image.lights[chain.light], history, true)
  }
  state.image = undefined
}

/** The light shafts of a view given back. */
export function disposeLightShafts(gpu: { lightShafts?: LightShaftsGpu }) {
  gpu.lightShafts?.dispose()
  gpu.lightShafts = undefined
}
