/**
 * THE LIGHT GROUP of a deferred program (`program.ts`): the frame's resources named, an absent one
 * by its stand-in, and the group made again only when one of them was replaced.
 */
import { DEFERRED_BINDINGS } from './bindings.ts'
import { receiverEntries, type ReceiverResources } from '../../webgpu/visibility/receiver.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import type { DeferredPlaceholders } from './setup.ts'
import { CONTRACT_SHADOW_BINDINGS, CONTRACT_VSM_BINDINGS } from '../direct/shadowBindings.ts'
import type { ComposeInput } from './shaders.ts'
import type { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import type { createCompositions } from './compositions.ts'
import { sequentialEntries, namedEntries } from '../../gpu/core/computeBindings.ts'
import type { DeferredBindings, DeferredSources, DirectLightResources } from './program.ts'

/** A composition: its group, and the input its pipelines compose (`compositions`). */
type Composition = { group: GPUBindGroup; input: ComposeInput }
type VsmResources = NonNullable<DirectLightResources['vsm']>

/** What a program keeps between its calls: what its light group names, rebuilt when one of them is
 *  replaced (`bindIdentity.ts`) — two identities are held, with a group each (`held`, by identity
 *  slot, with the flags it was made with): the shadow maps' tables are double-buffered, this
 *  frame's then the other's, and their frames take turns —, the bound surface, its lit image and
 *  its flags — the share the lit image is composed with —, the light group, and its compositions,
 *  one per colour and share read, weakly keyed by every view it reads: nothing to reset. */
export type ProgramState = {
  identity: ReturnType<typeof createWebgpuBindIdentity>
  boundSurface?: SurfaceBuffer
  boundHdr?: GPUTextureView
  boundFlags?: GPUTextureView
  lightGroup?: GPUBindGroup
  held: ({ group: GPUBindGroup; flags: GPUTextureView } | undefined)[]
  composed: WeakMap<GPUTextureView, WeakMap<GPUTextureView, Composition>>
}

/** What a program's groups are made of, fixed for its life. */
export type ProgramParts = {
  device: GPUDevice
  sources: DeferredSources
  bindings: DeferredBindings
  lightingLayout: GPUBindGroupLayout
  compositions: Awaited<ReturnType<typeof createCompositions>>
  /** The virtual shadow maps' stand-ins as a frame's group (`DirectLightResources.vsm`), made
   *  once: a frame without maps binds them and allocates nothing. */
  vsmPlaceholders: VsmResources
}

/** The program's `bind`: names the frame's resources, an absent one by its stand-in, and rebuilds
 *  the light group only when one of them was replaced. */
export function bindLight(
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
    receiver = direct.receiver ?? placeholders.receiver,
    reflection = direct.reflection ?? placeholders.reflection
  state.boundHdr = hdr
  const { next } = state.identity
  next[0] = surface
  next[1] = lights
  next[2] = tiles
  next[3] = vsm.pageTable
  next[4] = mask
  next[5] = probes
  for (let i = 0; i < receiver.length; i++) next[6 + i] = receiver[i]
  next[6 + receiver.length] = vsm.projectionData
  next[7 + receiver.length] = vsm.uniforms
  next[8 + receiver.length] = vsmTransmission
  next[9 + receiver.length] = maskTiles
  next[10 + receiver.length] = reflection
  state.boundSurface = surface
  if (reboundLight(state)) return
  state.boundFlags = surface.views()[3]
  const entries: GPUBindGroupEntry[] = [
    ...sequentialEntries(surface.views()),
    ...namedEntries(DEFERRED_BINDINGS, { depth, view: { buffer: bindings.uniform } }),
  ]
  if (sources.direct) {
    if (!lights) throw new Error('the contract program binds no declared-light buffer')
    const contract = {
      lights,
      tiles,
      vsm,
      mask,
      maskTiles,
      vsmTransmission,
      receiver,
      reflection,
    }
    entries.push(...contractEntries(placeholders, surface, contract))
  }
  if (sources.bounce && direct.bounceGrid && direct.probes)
    entries.push(
      ...namedEntries(DEFERRED_BINDINGS, {
        bounceGrid: { buffer: direct.bounceGrid },
        probes: direct.probes,
      }),
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
 *  lobes, its lights, their tiles and shadows. */
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
    receiver: ReceiverResources
    reflection: GPUTextureView
  },
): GPUBindGroupEntry[] {
  return [
    ...receiverEntries(DEFERRED_BINDINGS.receiver, r.receiver),
    { binding: DEFERRED_BINDINGS.subsurface, resource: surface.subsurfaceView },
    { binding: DEFERRED_BINDINGS.lobes, resource: surface.lobesView },
    ...namedEntries(DEFERRED_BINDINGS, {
      lights: { buffer: r.lights },
      tiles: { buffer: r.tiles },
    }),
    ...namedEntries(CONTRACT_VSM_BINDINGS, {
      pageTable: { buffer: r.vsm.pageTable },
      projectionData: { buffer: r.vsm.projectionData },
      uniforms: { buffer: r.vsm.uniforms },
    }),
    { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: r.mask },
    { binding: DEFERRED_BINDINGS.maskTiles, resource: r.maskTiles },
    { binding: DEFERRED_BINDINGS.transmissionResolve, resource: r.vsmTransmission },
    { binding: DEFERRED_BINDINGS.reflection, resource: r.reflection },
  ]
}
