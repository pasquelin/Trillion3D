import {
  askLightFunctionPrograms,
  lightFunctionResources,
} from '../../lighting/lightFunction/frame.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import type { DirectLightResources } from '../../lighting/deferred/program.ts'
import type { LitPrograms } from '../../lighting/deferred/contractVariants.ts'
import {
  FULL_CONTRACT,
  type ContractKey,
  type LitPass,
} from '../../lighting/deferred/contractCuts.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { skyLightReadOf } from '../render/skyLightState.ts'
import { cloudShadowOf } from '../render/encodeCloudShadow.ts'
import {
  vsmConsumerResources,
  vsmShadowMask,
  vsmShadowedLightGrid,
  vsmSunShadowMask,
} from '../../lighting/shadows/vsm/frame/vsmConsumers.ts'
import { shadowsOn } from '../../lighting/shadows/vsm/frame/vsmFarShadow.ts'
import { sunShadowMask } from '../../lighting/distanceField/shadow/state.ts'
import { skyOcclusionRead } from '../../lighting/distanceField/ao/state.ts'
import { lobesHeld, rowsWearLobes } from './lobesTarget.ts'
import { wantsContractLighting } from './lit.ts'
import { tracesFrontLayer } from '../../lighting/reflections/settings.ts'
import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { waterTraces } from '../../blend/water/waterReflection.ts'
import { waterSeparates } from '../../blend/water/waterTargets.ts'
import { track } from '../../lighting/deferred/compileLedger.ts'
import { drawsLit, showsRaw } from '../../visibility/shader/shadeMode.ts'
import { unlitLights } from '../render/captureLights.ts'
import { fogReadOf } from '../render/localFogGpu.ts'
import { volumetricLightmapOf } from '../../lighting/volumetricLightmap/frame.ts'

/** Whether the image shows the lit image as the lighting draws it — a lit view that paints no raw
 *  values (`showsRaw`) —: what the air and the fog are laid over; the unlit view and the views that
 *  paint raw values show neither. */
export const litImageShown = (rt: WebgpuPagesRuntime) =>
  wantsContractLighting(rt) && !showsRaw(rt.run.diagnostic)

/** Whether the image can hold an as-is pixel: a row showed a surface as-is, or a diagnostic view
 *  the resolve paints writes the flag — a view of the lit image writes none (`drawsLit`).
 *  Otherwise every share is 0, and TAA and composition read no flags (OMB-11). */
export const readsAsIs = ({ vis, run }: WebgpuPagesRuntime) =>
  vis.asIsShown || !drawsLit(run.diagnostic)

/** Whether the surfaces `pass` lights carry an anisotropic or clear-coat lobe: its programs then
 *  hold the lobe code. The opaque lit passes', a row's that the targets hold the lobes of; the
 *  translucent layers', their items' (`refreshBlendScene`). */
function lobedFor(pass: LitPass, rt: WebgpuPagesRuntime) {
  if (pass === 'blend') return rt.blendState.lobed
  return lobesHeld(rt) && rowsWearLobes(rt)
}

/** The key a first frame of `pass` asks for, fresh: the declared lights' and the pass's lobes, the
 *  shadow code only where a light takes a shadow (`shadowsOn`). */
export const keyFor = (pass: LitPass, rt: WebgpuPagesRuntime) =>
  contractKey(rt.lights.store, shadowsOn(rt), lobedFor(pass, rt))

/** The lit programs prepare compiles beside the others when the image wants the contract (#1362),
 *  with bounce too when the session wants it; a failed one is said, then or later. The one it
 *  starts is the one the first frame asks for (`keyFor`), read off the declared lights. */
export const litPrograms = (rt: WebgpuPagesRuntime): LitPrograms => ({
  precompile: wantsContractLighting(rt),
  bounce: rt.bounce.wanted,
  key: keyFor('opaque', rt),
  onFailure: (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  localFog: rt.setup.localFog,
})

/** What the blend programs are built with (`createWebgpuBlendPipelines`): the session's
 *  context, and the key each pass's first frame asks for, as the lit programs' (`keyFor`); a failed
 *  variant is said, the pass's twin lighting in its place; how they cut at a view's plane (the
 *  project switch, `../../gpu/core/clipDistances.ts`) and whether they read the clouds' shade per
 *  vertex (the project switch `cloudShadowOnTranslucent`, `../../blend/cloudVertex.ts`), how their
 *  fragments read a light's shadow (the project switches `shadowTranslucentQuality` and
 *  `shadowTranslucentLocalLights`, `../../lighting/direct/shadowWgsl.ts`), whether they light a
 *  rectangle light as a rectangle (`translucentRectLights`), and whether the settings trace the
 *  transparents' front layer (`reflectionFrontLayer`, the front stage compiled). */
export const blendContext = (rt: WebgpuPagesRuntime) => {
  const lit = (pass: LitPass) => ({
    precompile: wantsContractLighting(rt),
    key: keyFor(pass, rt),
    onFailure: (error: unknown) =>
      rt.diag.diagnosticFailure('forward-lighting-program-failed', error),
  })
  return {
    ...rt.context,
    lit: lit('blend'),
    clipping: rt.setup.clipping,
    cloudShade: rt.blendState.cloudShade,
    translucentShadow: rt.setup.translucentShadow,
    translucentRectLights: rt.setup.translucentRectLights,
    localFog: rt.setup.localFog,
    rasters: rt.vis.rasters,
    frontLayer: tracesFrontLayer(rt.context),
    waterReflects: waterTraces(rt),
    waterSeparate: waterSeparates(rt),
    waterSunTrace: readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportVsmFiltering'),
  }
}

/**
 * The contract program a frame lights with, keyed on stable state alone, the kinds the store
 * counts as its lights change (#1362, `createLightKinds`): narrow while the scene's lights fit a tile list (#849); shadow
 * code while a light declares a shadow and `shadowed`, the shadow raster is fitted (#1249), the
 * read of a kind of light (a sun's, a local light's) while a light of that kind declares one
 * (`ShadowKinds`); rectangle code while a light is a rectangle (#1369); lobe code while a surface
 * the pass lights carries a lobe (`lobed`, `../../materials/surface/physicalLobes.ts`). Never on a slot held
 * this frame: a lamp that moves, a page that comes and goes, asks no other program. Written into
 * `key`, fresh unless a frame hands in the one it reuses from one image to the next.
 */
function contractKey(
  store: LightStore,
  shadowed: boolean,
  lobed: boolean,
  key: Partial<ContractKey> = {},
) {
  const sun = store.shadowedSuns > 0,
    local = store.shadowedLocals > 0,
    rect = store.rects > 0
  key.narrow = store.count <= LIGHT_SETTINGS.tileLights
  key.unshadowed = !shadowed || !(sun || local)
  key.rectless = !rect
  key.sunless = !key.unshadowed && !sun
  key.localless = !key.unshadowed && !local
  key.lobeless = !lobed
  return key as ContractKey
}

type LightStore = WebgpuPagesRuntime['lights']['store']
/** The lit program the frame waits for (#1362): while the image wants the contract and no compiled
 *  program can light it, its compile — never the unlit stand-in meanwhile —, else nothing. */
export function litProgramPending(rt: WebgpuPagesRuntime) {
  const { deferred } = rt.gpu
  // A lit image already has its program: nothing to read (`deviceAnswering` asks every frame).
  return deferred && !deferred.usesContract && wantsContractLighting(rt)
    ? deferred.awaited(directLightResources(rt))
    : undefined
}

/**
 * At a frame's entry, the lobe code its lit passes need — the opaque lit passes' where a row wears a
 * lobed surface, the translucent layers' where their items carry a lobe —, asked off the frame, the frame held while none can light it (`track`):
 * never an image of a lobed surface drawn without its lobes (#1483). A pass waits for its program
 * with every code path, which lights any lobed frame (`SERVING`); its own, asked by the frame, then
 * takes over. O(1) once each landed, nothing asked by a scene without a lobe.
 */
export function askLobedPrograms(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!wantsContractLighting(rt)) return
  askLightFunctionPrograms(rt, device)
  const { deferred } = rt.gpu
  // The fog pass is asked now, the frames waiting for its compile, not at the first image it lays fog on.
  deferred?.askFog()
  if (deferred && rowsWearLobes(rt)) track(device, deferred.awaited(FULL_CONTRACT), true)
}

const contractResources: DirectLightResources = {}

/** The shadow resources the deferred pass reads, none where the lighting is not the contract's. */
function shadowResources(rt: WebgpuPagesRuntime, active: boolean) {
  contractResources.vsmMask = active ? vsmShadowMask(rt) : undefined
  contractResources.vsmLightGrid = active ? vsmShadowedLightGrid(rt) : undefined
  contractResources.vsmSunMask = active ? vsmSunShadowMask(rt) : undefined
  contractResources.farShadowMask = active ? sunShadowMask(rt) : undefined
  contractResources.vsm = active ? vsmConsumerResources(rt) : undefined
}

/** The directional lights' ranks the sun's pass walks, and the bounce grid. */
function bounceResources(rt: WebgpuPagesRuntime, lit: boolean) {
  // The directional lights' ranks the sun's pass walks: none for a view whose light buffer is cleared
  // of its lights.
  contractResources.sunRanks = lit ? rt.lights.sunRanks : undefined
  // The grid is named only if it exists: without it, the deferred pass compiles and binds the
  // contract program alone, with no bounce.
  const bounce = lit && rt.bounce.wanted ? rt.bounce.probes : undefined
  contractResources.bounceGrid = bounce?.uniform
}

/** The sky light's cubes and harmonics, and the clouds' shade of the lights. */
function skyResources(rt: WebgpuPagesRuntime, active: boolean) {
  // The sky light's cubes and harmonics, and the clouds' shade of the lights: the stand-ins give none.
  contractResources.sky = active && rt.gpu.device ? skyLightReadOf(rt) : undefined
  contractResources.cloudShadow = active ? cloudShadowOf(rt) : undefined
}

/** The fog's cubemap and volume, and the haze the air built this image. */
function fogResources(rt: WebgpuPagesRuntime, active: boolean) {
  // What the fog's cubemap and volume this image built are read through (`encodeFogVolume`).
  contractResources.fog = active ? fogReadOf(rt) : undefined
  // The volume of the haze the air built this image, which the fog pass samples (`hazeSampledWgsl`).
  contractResources.haze = active ? rt.gpu.atmosphere?.hazeVolume : undefined
}

/** What the lit view reads of the passes before it: light shafts, light functions, screen probes,
 *  ambient occlusion, volumetric lightmap, sky occlusion. */
function litPassResources(rt: WebgpuPagesRuntime, lit: boolean) {
  // The light shafts' occlusion mask the fog is multiplied by (`../../modules/sky/lightShafts/frame.ts`).
  contractResources.lightShaft = lit ? rt.gpu.lightShafts?.mask : undefined
  // The light functions' atlas and table (`../../lighting/lightFunction/frame.ts`).
  contractResources.lightFunction = lit
    ? lightFunctionResources(rt, 'lightFunctionDeferred')
    : undefined
  // What the screen probes left of the pixels' indirect light this image (`../../lighting/bounce/screen/frame.ts`).
  contractResources.screenIndirect = lit ? rt.gpu.screenProbes?.indirect : undefined
  // The ambient occlusion this image drew (`../../lighting/ao/frame.ts`).
  contractResources.ambientOcclusion = lit ? rt.gpu.ambientOcclusion?.output : undefined
  // The volumetric lightmap, where the scene has one and the setting reads it
  // (`../../lighting/deferred/volumetricLightPass.ts`).
  contractResources.volumetricLightmap =
    lit && rt.gpu.device ? volumetricLightmapOf(rt, rt.gpu.device) : undefined
  // The sky light's distance-field occlusion this image drew (`../render/encodeSkyOcclusion.ts`): the program that applies it.
  contractResources.skyShadowing = lit ? skyOcclusionRead(rt) : undefined
}

/** The resources the last `directLightResources` of the frame resolved: the one object, as it stands. */
export const heldDirectLightResources = () => contractResources

/**
 * Contract resources the deferred pass binds, or nothing when they do not exist. Each is returned as
 * it is held elsewhere, never copied or rebuilt: the pass compares what it is given to what it has
 * bound, and rebuilds its bind group only if that has changed. The object itself is reused from one
 * image to the next: the pass allocates nothing.
 */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    active = wantsContractLighting(rt),
    // A view that is not lit (`ViewOverrides.lighting`) reads the light buffer cleared of its
    // lights, and no list, probe, reflection nor occlusion.
    lit = active && rt.views.active.overrides.lighting
  contractResources.lights = active && !lit ? unlitLights(rt) : lights.buffer
  contractResources.tiles = lit ? lights.tiles?.buffer : undefined
  // The lights the sun's pass and the local lights' pass walk: none for a view whose light buffer is
  // cleared of its lights.
  contractResources.suns = lit ? lights.store.suns : 0
  contractResources.locals = lit ? lights.store.locals : 0
  // The narrow resolve reads the narrow pass's lists (#849); a scene with no declared shadow, or
  // no rectangle, resolves without that code (#1249, #1369): all read off stable state.
  if (active) {
    // Lobe code while the targets hold the lobes of a surface that carries one (`physicalLobes.ts`).
    const shadowed = shadowsOn(rt) && (!!lights.pageLayout || !!lights.vsm)
    contractKey(lights.store, shadowed, lobedFor('opaque', rt), contractResources)
    contractResources.narrow &&= !!lights.tiles
  } else Object.assign(contractResources, FULL_CONTRACT)
  shadowResources(rt, active)
  bounceResources(rt, lit)
  skyResources(rt, active)
  // The share of the radiance the opaque trace wrote this image (`../../lighting/reflections/frame.ts`).
  contractResources.reflection = lit ? rt.gpu.reflection?.targetView : undefined
  fogResources(rt, active)
  litPassResources(rt, lit)
  return contractResources
}
