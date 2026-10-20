import { LIGHT_SETTINGS } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { DirectLightResources } from '../../../lighting/deferred/program.ts'
import type { LitPrograms } from '../../../lighting/deferred/contractVariants.ts'
import {
  FULL_CONTRACT,
  type ContractKey,
  type LitPass,
} from '../../../lighting/deferred/contractCuts.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { receiverResources } from '../../visibility/receiver.ts'
import {
  vsmConsumerResources,
  vsmShadowMask,
  vsmShadowMaskTiles,
  vsmShadowThrough,
  vsmTransmissionView,
} from '../render/vsm/vsmConsumers.ts'
import { lobesHeld, rowsWearLobes } from './lobesTarget.ts'
import { track } from '../../../lighting/deferred/compileLedger.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'

/**
 * True when the image must be lit by the declared lights. False in the only unlit view: `unlit`
 * requested by the host, or `auto` on a scene with no light — there, raw albedo comes out as-is.
 *
 * The light count does not enter the decision. An explicitly requested `lit` view lights even with
 * no light: the contract then outputs black, emissives kept, and that is the right answer — a scene
 * no source lights is black. Falling back to albedo made a room bright when the host had just turned
 * off all its lights, with no blackout showing.
 */
export function wantsContractLighting(rt: WebgpuPagesRuntime) {
  return !rt.lights.store.unlit
}

/** Whether the image can hold an as-is pixel: a row showed a surface as-is, or a diagnostic view
 *  the resolve paints writes the flag — a view of the lit image writes none (`drawsLit`).
 *  Otherwise every share is 0, and TAA and composition read no flags (OMB-11). */
export const readsAsIs = ({ vis, run }: WebgpuPagesRuntime) =>
  vis.asIsShown || !drawsLit(run.diagnostic)

/** Whether the surfaces `pass` lights carry an anisotropic or clear-coat lobe: its programs then
 *  hold the lobe code. The opaque resolve's, a row's that the targets hold the lobes of; the
 *  translucent layers', their items' (`refreshBlendScene`). */
function lobedFor(pass: LitPass, rt: WebgpuPagesRuntime) {
  if (pass === 'blend') return rt.blendState.lobed
  return lobesHeld(rt) && rowsWearLobes(rt)
}

/** The key a first frame of `pass` asks for, fresh: the declared lights' and the pass's lobes. */
const keyFor = (pass: LitPass, rt: WebgpuPagesRuntime) =>
  contractKey(rt.lights.store, true, lobedFor(pass, rt))

/** The lit programs prepare compiles beside the others when the image wants the contract (#1362),
 *  with bounce too when the session wants it; a failed one is said, then or later. The one it
 *  starts is the one the first frame asks for (`keyFor`), read off the declared lights. */
export const litPrograms = (rt: WebgpuPagesRuntime): LitPrograms => ({
  precompile: wantsContractLighting(rt),
  bounce: rt.bounce.wanted,
  key: keyFor('opaque', rt),
  onFailure: (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
})

/** What the blend programs are built with (`createWebgpuBlendPipelines`): the session's
 *  context, and the key each pass's first frame asks for, as the lit programs' (`keyFor`); a failed
 *  variant is said, the pass's twin lighting in its place. */
export const blendContext = (rt: WebgpuPagesRuntime) => {
  const lit = (pass: LitPass) => ({
    precompile: wantsContractLighting(rt),
    key: keyFor(pass, rt),
    onFailure: (error: unknown) =>
      rt.diag.diagnosticFailure('forward-lighting-program-failed', error),
  })
  return { ...rt.context, lit: lit('blend') }
}

/**
 * The contract program a frame lights with, keyed on stable state alone, the kinds the store
 * counts as its lights change (#1362, `createLightKinds`): narrow while the scene's lights fit a tile list (#849); shadow
 * code while a light declares a shadow and `shadowed`, the shadow raster is fitted (#1249), the
 * read of a kind of light (a sun's, a local light's) while a light of that kind declares one
 * (`ShadowKinds`); rectangle code while a light is a rectangle (#1369); lobe code while a surface
 * the pass lights carries a lobe (`lobed`, `../../../scene/physicalLobes.ts`). Never on a slot held
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
 * At a frame's entry, the lobe code its lit passes need — the opaque resolve's where a row wears a
 * lobed surface, the translucent layers' where their items carry a lobe —, asked off the frame, the frame held while none can light it (`track`):
 * never an image of a lobed surface drawn without its lobes (#1483). A pass waits for its program
 * with every code path, which lights any lobed frame (`SERVING`); its own, asked by the frame, then
 * takes over. O(1) once each landed, nothing asked by a scene without a lobe.
 */
export function askLobedPrograms(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (!wantsContractLighting(rt)) return
  const { vis, blendState } = rt,
    { deferred } = rt.gpu
  if (deferred && rowsWearLobes(rt)) track(device, deferred.awaited(FULL_CONTRACT), true)
  if (blendState.lobed) track(device, vis.blendPipelines?.lobedAwaited(), true)
}

const contractResources: DirectLightResources = {}

/**
 * Contract resources the deferred pass binds, or nothing when they do not exist. Each is returned as
 * it is held elsewhere, never copied or rebuilt: the pass compares what it is given to what it has
 * bound, and rebuilds its bind group only if that has changed. The object itself is reused from one
 * image to the next: the pass allocates nothing.
 */
export function directLightResources(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    active = wantsContractLighting(rt)
  contractResources.lights = lights.buffer
  contractResources.tiles = active ? lights.tiles?.buffer : undefined
  // The narrow resolve reads the narrow pass's lists (#849); a scene with no declared shadow, or
  // no rectangle, resolves without that code (#1249, #1369): all read off stable state.
  if (active) {
    // Lobe code while the targets hold the lobes of a surface that carries one (`physicalLobes.ts`).
    const shadowed = !!lights.pageLayout || !!lights.vsm
    contractKey(lights.store, shadowed, lobedFor('opaque', rt), contractResources)
    contractResources.narrow &&= !!lights.tiles
  } else Object.assign(contractResources, FULL_CONTRACT)
  contractResources.vsmMask = active ? vsmShadowMask(rt) : undefined
  contractResources.vsmMaskTiles = active ? vsmShadowMaskTiles(rt) : undefined
  contractResources.vsmTransmission = active ? vsmTransmissionView(rt) : undefined
  contractResources.vsmThrough = active ? vsmShadowThrough(rt) : undefined
  contractResources.vsm = active ? vsmConsumerResources(rt) : undefined
  // The grid is bound only if it exists: without it, the deferred pass compiles and binds the
  // contract program alone, exactly the one from before the bounce lot.
  const bounce = active && rt.bounce.wanted ? rt.bounce.probes : undefined
  contractResources.bounceGrid = bounce?.uniform
  contractResources.probes = bounce?.probes
  // The shadow receiver the resolve wrote (`receiverTargetWgsl.ts`).
  contractResources.receiver = active ? receiverResources(rt) : undefined
  // The share of the radiance the opaque trace wrote this image (`../../../reflections/frame.ts`).
  contractResources.reflection = active ? rt.gpu.reflection?.targetView : undefined
  return contractResources
}
