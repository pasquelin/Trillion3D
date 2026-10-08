import { SUBSURFACE_BINDING } from '../../scene/subsurface.ts'
import { PHYSICAL_LOBES_BINDING } from '../../scene/physicalLobes.ts'
import { LIGHTING_RECEIVER_BINDING } from './surfaceWgsl.ts'
import { receiverEntries, type ReceiverResources } from '../../webgpu/visibility/receiver.ts'
import { reflectionPipelines } from '../../reflections/pipelines.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { createDeferredLightingLayout, type DeferredPlaceholders } from './setup.ts'
import { RESIDENT_PROXY_BINDING } from '../../bounce/nodeWgsl.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts'
import { CONTRACT_VSM_BINDINGS } from '../direct/shadowWgsl.ts'
import { VSM_TRANSMISSION_RESOLVE_BINDING } from '../../vsm/transmissionWgsl.ts'
import { VSM_MASK_TABLE_BINDING, VSM_MASK_TILES_BINDING } from '../../vsm/projectionMaskTable.ts'
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts'
import type { ComposeInput, LitProgram } from './shaders.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { ContractKey } from './contractCuts.ts'
import { makeFullscreenPipeline } from './fullscreen.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { createCompositions, type CompositionSources } from './compositions.ts'
import { type FusedBlend } from '../../webgpu/effects/webgpuKinds.ts'

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. With them,
 *  the frame's key: what its program leaves out (`contractCuts.ts`). */
export interface DirectLightResources extends Partial<ContractKey> {
  /** The declared lights, grown with the scene: the one buffer a contract program reads them from. */
  lights?: GPUBuffer
  tiles?: GPUBuffer
  /** The virtual shadow maps a non-mask read samples (`CONTRACT_VSM_BINDINGS`): this frame's
   *  page table, projection data and uniforms, and the pool's dynamic slice. */
  vsm?: { pageTable: GPUBuffer; projectionData: GPUBuffer; uniforms: GPUBuffer; pool: GPUBuffer }
  /** The virtual shadow maps' traced mask array (`vsmEncode.ts`), one 8-bit lane per shadowed
   *  light: bound on the transmittance's number. */
  vsmMask?: GPUTextureView
  /** The mask's tile words (`vsmMaskFactor`): the layers its projection stored in each 8×8 tile. */
  vsmMaskTiles?: GPUTextureView
  /** The translucent casters' transmission atlas (`../../vsm/transmissionPass.ts`), or none. */
  vsmTransmission?: GPUTextureView
  /** Probe grid, coefficients, mirror surface cache — the two atlases of `atlas.ts`: one
   *  lifetime, the probes' identity. */
  bounceGrid?: GPUBuffer
  probes?: GPUTextureView
  surfaceCache?: GPUTextureView
  /** Resident proxy; absent, a zero substitute. */
  proxy?: GPUBuffer
  receiver?: ReceiverResources // what the receiver offset reads
}
export interface DeferredSources {
  /** The lighting program (`contractLightingProgram`): its plain pass compiles it at its own
   *  mirror radiance, its reflection passes at the screen's (`reflectionPipelines`). */
  lighting: LitProgram
  compose: CompositionSources
  label: string
  direct: boolean
  bounce?: boolean
  unboundedReflections?: boolean // a reference session's rough trace (`reflectionTrace`)
}
/** What composition reads: a colour and its accumulated share, else the lit image's flags, and
 *  the chain's last blend when it left it to the composition. */
export type ComposedImage = { color: GPUTextureView; share?: GPUTextureView; bloom?: FusedBlend }
/** What the temporal pass resolves: the colour, its pixels' as-is share, the filtering layers. */
export type AccumulatedImage = Required<Omit<ComposedImage, 'bloom'>> & {
  filter?: readonly [GPUTextureView, GPUTextureView]
}
export interface DeferredBindings {
  uniform: GPUBuffer
  placeholders: DeferredPlaceholders
}

export type DeferredProgram = Awaited<ReturnType<typeof createDeferredProgram>>

const HDR: GPUColorTargetState[] = [{ format: 'rgba16float' }]

/** A composition: its group, and the input its pipelines compose (`compositions`). */
type Composition = { group: GPUBindGroup; input: ComposeInput }
type VsmResources = NonNullable<DirectLightResources['vsm']>

/** What a program keeps between its calls: what its light group names, rebuilt when one of them is
 *  replaced (`bindIdentity.ts`) — two identities are held, with a group each (`held`, by identity
 *  slot, with the flags it was made with): the shadow maps' tables are double-buffered, this
 *  frame's then the other's, and their frames take turns —, the bound surface, its lit image and
 *  its flags — the share the lit image is composed with —, the light group, and its compositions,
 *  one per colour and share read, weakly keyed by every view it reads: nothing to reset. */
type ProgramState = {
  identity: ReturnType<typeof createWebgpuBindIdentity>
  boundSurface?: SurfaceBuffer
  boundHdr?: GPUTextureView
  boundFlags?: GPUTextureView
  lightGroup?: GPUBindGroup
  held: ({ group: GPUBindGroup; flags: GPUTextureView } | undefined)[]
  composed: WeakMap<GPUTextureView, WeakMap<GPUTextureView, Composition>>
}

/** What a program's groups are made of, fixed for its life. */
type ProgramParts = {
  device: GPUDevice
  sources: DeferredSources
  bindings: DeferredBindings
  lightingLayout: GPUBindGroupLayout
  compositions: Awaited<ReturnType<typeof createCompositions>>
  /** The virtual shadow maps' stand-ins as a frame's group (`DirectLightResources.vsm`), made
   *  once: a frame without maps binds them and allocates nothing. */
  vsmPlaceholders: VsmResources
}

/** A deferred-pass program: its modules, its pipelines compiled together off the thread,
 *  and the bind groups it keeps while its resources do not change. */
export async function createDeferredProgram(
  device: GPUDevice,
  sources: DeferredSources,
  bindings: DeferredBindings,
) {
  const lighting = await createCheckedShaderModule(
    device,
    wgslModule(sources.lighting()),
    `${sources.label}_LIGHTING`,
  )
  const lightingLayout = createDeferredLightingLayout(device, sources.direct, sources.bounce)
  const [light, reflection, compositions] = await Promise.all([
    makeFullscreenPipeline(device, lighting, lightingLayout, 'lightSurface', HDR),
    sources.direct
      ? reflectionPipelines(device, sources.lighting, lightingLayout, sources)
      : undefined,
    createCompositions(device, sources.compose, sources.label),
  ])
  const { placeholders } = bindings
  const vsmPlaceholders = {
    pageTable: placeholders.vsmPageTable,
    projectionData: placeholders.vsmProjectionData,
    uniforms: placeholders.vsmUniforms,
    pool: placeholders.vsmPool,
  }
  const parts = { device, sources, bindings, lightingLayout, compositions, vsmPlaceholders }
  const state: ProgramState = {
    identity: createWebgpuBindIdentity(2),
    held: [],
    composed: new WeakMap(),
  }
  return {
    light,
    reflection,
    get lightGroup() {
      return state.lightGroup
    },
    compositions,
    /** The group reading the lit image and its surface flags, or `image` and its as-is share,
     *  and the input its pipelines compose (`compositions`); `undefined` before `bind`. A frame
     *  that reads no as-is share (`asIs` false) binds the colour alone. */
    composition: (image?: ComposedImage, asIs = true) => compositionOf(state, parts, image, asIs),
    bind: (
      surface: SurfaceBuffer,
      depth: GPUTextureView,
      hdr: GPUTextureView,
      direct: DirectLightResources,
    ) => bindLight(state, parts, surface, depth, hdr, direct),
    release() {
      state.identity = createWebgpuBindIdentity(2)
      state.held.length = 0
      state.boundSurface = state.boundHdr = state.boundFlags = state.lightGroup = undefined
      state.composed = new WeakMap()
    },
  }
}

/** The program's `composition` (`createDeferredProgram`), kept under its colour and share. */
function compositionOf(
  state: ProgramState,
  { device, bindings, compositions }: ProgramParts,
  image: ComposedImage | undefined,
  asIs: boolean,
) {
  const view = image?.color ?? state.boundHdr,
    // The flagless group is kept under its colour: no share view is ever a colour one.
    share = asIs ? (image?.share ?? state.boundFlags) : view
  if (!view || !share || !state.boundSurface) return undefined
  let byShare = state.composed.get(view)
  if (!byShare) state.composed.set(view, (byShare = new WeakMap()))
  const kept = byShare.get(share)
  if (kept) return kept
  // A colour without its own share (the effect chain's, no TAA) reads the lit image's flags.
  const input = !asIs ? 'flagless' : image?.share ? 'accumulated' : 'still'
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: view },
    { binding: 1, resource: { buffer: bindings.uniform } },
  ]
  if (asIs) entries.push({ binding: 2, resource: share })
  const group = device.createBindGroup({ layout: compositions.layouts[input], entries })
  const composition = { group, input } as const
  byShare.set(share, composition)
  return composition
}

/** The program's `bind`: names the frame's resources, an absent one by its stand-in, and rebuilds
 *  the light group only when one of them was replaced. */
function bindLight(
  state: ProgramState,
  parts: ProgramParts,
  surface: SurfaceBuffer,
  depth: GPUTextureView,
  hdr: GPUTextureView,
  direct: DirectLightResources,
) {
  const { sources, bindings } = parts,
    { placeholders } = bindings
  const lights = direct.lights,
    tiles = direct.tiles ?? placeholders.tiles,
    vsm = direct.vsm ?? parts.vsmPlaceholders,
    mask = direct.vsmMask ?? placeholders.vsmMask,
    maskTiles = direct.vsmMaskTiles ?? placeholders.vsmMaskTiles,
    vsmTransmission = direct.vsmTransmission ?? placeholders.transmittanceView,
    probes = direct.probes,
    proxy = direct.proxy ?? placeholders.proxy,
    receiver = direct.receiver ?? placeholders.receiver
  state.boundHdr = hdr
  const { next } = state.identity
  next[0] = surface
  next[1] = lights
  next[2] = tiles
  next[3] = vsm.pageTable
  next[4] = mask
  next[5] = probes
  next[6] = proxy
  for (let i = 0; i < receiver.length; i++) next[7 + i] = receiver[i]
  next[7 + receiver.length] = vsm.projectionData
  next[8 + receiver.length] = vsm.uniforms
  next[9 + receiver.length] = vsmTransmission
  next[10 + receiver.length] = maskTiles
  state.boundSurface = surface
  if (reboundLight(state)) return
  state.boundFlags = surface.views()[3]
  const entries: GPUBindGroupEntry[] = [
    ...surface.views().map((resource, binding) => ({ binding, resource })),
    { binding: 4, resource: depth },
    { binding: 5, resource: { buffer: bindings.uniform } },
  ]
  if (sources.direct) {
    if (!lights) throw new Error('the contract program binds no declared-light buffer')
    const contract = { lights, tiles, vsm, mask, maskTiles, vsmTransmission, proxy, receiver }
    entries.push(...contractEntries(placeholders, surface, contract))
  }
  if (sources.bounce && direct.bounceGrid && direct.probes && direct.surfaceCache)
    entries.push(
      { binding: 11, resource: { buffer: direct.bounceGrid } },
      { binding: 12, resource: direct.probes },
      { binding: BOUNCE_SURFACE_BINDING, resource: direct.surfaceCache },
    )
  state.lightGroup = parts.device.createBindGroup({ layout: parts.lightingLayout, entries })
  state.held[state.identity.slot] = { group: state.lightGroup, flags: state.boundFlags }
}

/** Whether the light group made for the identity this frame names is held: it is then bound
 *  again, with the flags it was made with, and nothing is made. */
function reboundLight(state: ProgramState) {
  const { identity, held } = state,
    kept = identity.moved() ? undefined : held[identity.slot]
  if (kept) {
    state.lightGroup = kept.group
    state.boundFlags = kept.flags
    return true
  }
  // Until it is made, the slot holds no group: a refused one is asked again.
  held[identity.slot] = undefined
  return false
}

/** The light group's entries a contract program adds: its receiver, its surface's subsurface and
 *  lobes, its lights, their tiles and shadows, and the resident proxy. */
function contractEntries(
  placeholders: DeferredPlaceholders,
  surface: SurfaceBuffer,
  r: {
    lights: GPUBuffer
    tiles: GPUBuffer
    vsm: VsmResources
    mask: GPUTextureView
    maskTiles: GPUTextureView
    vsmTransmission: GPUTextureView
    proxy: GPUBuffer
    receiver: ReceiverResources
  },
): GPUBindGroupEntry[] {
  return [
    ...receiverEntries(LIGHTING_RECEIVER_BINDING, r.receiver),
    { binding: SUBSURFACE_BINDING, resource: surface.subsurfaceView },
    { binding: PHYSICAL_LOBES_BINDING, resource: surface.lobesView },
    { binding: 6, resource: { buffer: r.lights } },
    { binding: 7, resource: { buffer: r.tiles } },
    { binding: CONTRACT_VSM_BINDINGS.pageTable, resource: { buffer: r.vsm.pageTable } },
    { binding: CONTRACT_VSM_BINDINGS.projectionData, resource: { buffer: r.vsm.projectionData } },
    { binding: CONTRACT_VSM_BINDINGS.uniforms, resource: { buffer: r.vsm.uniforms } },
    // The resident proxy as-is, no copy: its header says whether there is anything to trace.
    { binding: RESIDENT_PROXY_BINDING, resource: { buffer: r.proxy } },
    { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: r.mask },
    { binding: VSM_MASK_TABLE_BINDING, resource: placeholders.vsmMaskTable.view },
    { binding: VSM_MASK_TILES_BINDING, resource: r.maskTiles },
    { binding: VSM_TRANSMISSION_RESOLVE_BINDING, resource: r.vsmTransmission },
  ]
}
