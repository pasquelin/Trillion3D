import { createDeferredLightingLayout, type DeferredPlaceholders } from './setup.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { ContractKey } from './contractCuts.ts'
import { makeFullscreenPipeline } from './fullscreen.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createCompositions, type CompositionSources } from './compositions.ts'
import { type FusedBlend } from '../../post/effects/webgpuKinds.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { bindLight, type ProgramParts, type ProgramState } from './lightGroup.ts'

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. With them,
 *  the frame's key: what its program leaves out (`contractCuts.ts`). */
export interface DirectLightResources extends Partial<ContractKey> {
  /** The declared lights, grown with the scene: the one buffer a contract program reads them from. */
  lights?: GPUBuffer
  tiles?: GPUBuffer
  /** The virtual shadow maps a blend pass's fragments trace (`vsmTraceFactor`): this frame's page
   *  table, projection data and uniforms, the pool's first slice, and the projection's view and
   *  blue noise. */
  vsm?: {
    pageTable: GPUBuffer
    projectionData: GPUBuffer
    uniforms: GPUBuffer
    pool: GPUBuffer
    view: GPUBuffer
    noise: GPUTextureView
  }
  /** The virtual shadow maps' traced mask array (`vsmEncode.ts`), one 8-bit lane per shadowed
   *  light: bound on the transmittance's number. */
  vsmMask?: GPUTextureView
  /** The mask's tile words (`vsmMaskFactor`): the layers its projection stored in each 8×8 tile. */
  vsmMaskTiles?: GPUTextureView
  /** The translucent casters' transmission atlas (`../shadows/vsm/transmission/transmissionPass.ts`), or none: what a
   *  blend pass's rays read. */
  vsmTransmission?: GPUTextureView
  /** The mask's transmission (`VsmMask.through`): what the panes let through along each light's
   *  missed rays, the opaque resolve's; none without translucent casters. */
  vsmThrough?: GPUTextureView
  /** Probe grid and coefficients — an atlas of `atlas.ts`: one lifetime, the probes'
   *  identity. */
  bounceGrid?: GPUBuffer
  probes?: GPUTextureView
  /** The reflection target the opaque trace wrote (`../reflections/trace/trace.ts`); absent, a zero
   *  substitute. */
  reflection?: GPUTextureView
  receiver?: GPUTextureView // the resolve's shadow receiver target
}
export interface DeferredSources {
  /** The lighting program (`contractLightingProgram`). */
  lighting: WgslDecl
  compose: CompositionSources
  label: string
  direct: boolean
  bounce?: boolean
}
/** What composition reads: a colour and its accumulated share, else the lit image's flags; the
 *  glow the effect chain's last bloom left to it, and the group that finishes the image with it
 *  (`../../post/finish/frame.ts`) — none where the image is shown as it is. */
export type ComposedImage = {
  color: GPUTextureView
  share?: GPUTextureView
  glow?: FusedBlend['glow']
  finish?: GPUBindGroup
}
/** What the temporal pass resolves: the colour, its pixels' as-is share, the filtering layers. */
export type AccumulatedImage = Required<Omit<ComposedImage, 'glow' | 'finish'>> & {
  filter?: readonly [GPUTextureView, GPUTextureView]
}
export interface DeferredBindings {
  uniform: GPUBuffer
  placeholders: DeferredPlaceholders
}

export type DeferredProgram = Awaited<ReturnType<typeof createDeferredProgram>>

const HDR: GPUColorTargetState[] = [{ format: HDR_FORMAT }]

/** A deferred-pass program: its modules, its pipelines compiled together off the thread,
 *  and the bind groups it keeps while its resources do not change. */
export async function createDeferredProgram(
  device: GPUDevice,
  sources: DeferredSources,
  bindings: DeferredBindings,
) {
  const lighting = await createCheckedShaderModule(
    device,
    wgslModule(sources.lighting),
    `${sources.label}_LIGHTING`,
  )
  const lightingLayout = createDeferredLightingLayout(device, sources.direct, sources.bounce)
  const [light, compositions] = await Promise.all([
    makeFullscreenPipeline(device, lighting, lightingLayout, 'lightSurface', HDR),
    createCompositions(device, sources.compose, sources.label),
  ])
  const parts = { device, sources, bindings, lightingLayout, compositions }
  const state: ProgramState = {
    identity: createWebgpuBindIdentity(2),
    held: [],
    composed: new WeakMap(),
  }
  return {
    light,
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
  const entries = sequentialEntries([view, { buffer: bindings.uniform }, ...(asIs ? [share] : [])])
  const group = device.createBindGroup({ layout: compositions.layouts[input], entries })
  const composition = { group, input } as const
  byShare.set(share, composition)
  return composition
}
