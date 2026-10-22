/**
 * THE LIGHT GROUP of a deferred program (`program.ts`): the frame's resources named, an absent one
 * by its stand-in, and the group made again only when one of them was replaced.
 */
import {
  DEFERRED_BINDINGS,
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_FOG_BINDINGS,
  DEFERRED_LIGHT_FUNCTION_BINDINGS,
  DEFERRED_SKY_LIGHT_BINDINGS,
} from './bindings.ts'
import { cloudShadowBindEntries, type CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import { cloudShadowStandIn } from '../atmosphere/cloudShadowStandIn.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import { fogReadBindEntries, type FogRead } from '../fog/read.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import type { DeferredPlaceholders } from './setup.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'
import type { ComposeInput } from './shaders.ts'
import type { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import type { createCompositions } from './compositions.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { DeferredBindings, DeferredSources, DirectLightResources } from './program.ts'

/** A composition: its group, and the input its pipelines compose (`compositions`). */
type Composition = { group: GPUBindGroup; input: ComposeInput }

/** What a program keeps between its calls: what its light group names, rebuilt when one of them is
 *  replaced (`bindIdentity.ts`) — two identities are held, with a group each (`held`, by identity
 *  slot, with the flags it was made with): resources that take turns frame by frame keep their
 *  groups —, the bound surface, its lit image and
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
}

/** The surfaces' entries: the colour layers and the word layers whole, each one binding, and the emission's. */
const surfaceEntries = (surface: SurfaceBuffer): GPUBindGroupEntry[] =>
  namedEntries(DEFERRED_BINDINGS, {
    colours: surface.stores()[0],
    emissiveAo: surface.views()[2],
    words: surface.stores()[1],
  })

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
    mask = direct.vsmMask ?? placeholders.vsmMask,
    maskTiles = direct.vsmMaskTiles ?? placeholders.vsmMaskTiles,
    through = direct.vsmThrough ?? placeholders.vsmThrough,
    probes = direct.probes,
    reflection = direct.reflection ?? placeholders.reflection,
    fog = direct.fog ?? placeholders.fog,
    lightShaft = direct.lightShaft ?? placeholders.lightShaft,
    screen = direct.screenIndirect,
    occlusion = direct.ambientOcclusion ?? placeholders.ambientOcclusion,
    lightFunction = direct.lightFunction ?? placeholders.lightFunction,
    sky = direct.sky ?? skyLightStandIn(parts.device),
    cloudShadow = direct.cloudShadow ?? cloudShadowStandIn(parts.device)
  state.boundHdr = hdr
  const { next } = state.identity
  next[0] = surface
  next[1] = lights
  next[2] = tiles
  next[3] = mask
  next[4] = probes
  next[6] = through
  next[7] = maskTiles
  next[8] = reflection
  next[9] = screen
  next[10] = fog
  next[11] = occlusion
  next[12] = lightFunction
  next[13] = lightShaft
  next[5] = sky.cube
  next[14] = sky.params
  next[15] = cloudShadow.block
  next[16] = cloudShadow.maps[0]
  next[17] = cloudShadow.maps[1]
  state.boundSurface = surface
  if (reboundLight(state)) return
  state.boundFlags = surface.views()[3]
  const entries: GPUBindGroupEntry[] = [
    ...surfaceEntries(surface),
    ...namedEntries(DEFERRED_BINDINGS, { depth, view: { buffer: bindings.uniform } }),
  ]
  if (sources.direct) {
    if (!lights) throw new Error('the contract program binds no declared-light buffer')
    const contract = {
      lights,
      tiles,
      mask,
      maskTiles,
      through,
      sky,
      cloudShadow,
      reflection,
      fog,
      lightShaft,
      occlusion,
      lightFunction,
    }
    entries.push(...contractEntries(placeholders, surface, contract))
  }
  if (sources.bounce && direct.bounceGrid && direct.probes)
    entries.push(
      ...bounceEntries(direct.bounceGrid, direct.probes, screen ?? placeholders.screenIndirect),
    )
  state.lightGroup = parts.device.createBindGroup({ layout: parts.lightingLayout, entries })
  state.held[state.identity.slot] = { group: state.lightGroup, flags: state.boundFlags }
}

/** The bounce program's entries: the probe grid and its atlas, and what the screen probes left of
 *  the pixels' indirect light, or the stand-in that says none ran. */
const bounceEntries = (
  bounceGrid: GPUBuffer,
  probes: GPUTextureView,
  screenIndirect: GPUTextureView,
) => namedEntries(DEFERRED_BINDINGS, { bounceGrid: { buffer: bounceGrid }, probes, screenIndirect })

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
 *  lobes, its lights, their tiles and shadows, its fog and its ambient occlusion. */
function contractEntries(
  placeholders: DeferredPlaceholders,
  surface: SurfaceBuffer,
  r: {
    lights: GPUBuffer
    tiles: GPUBuffer
    mask: GPUTextureView
    maskTiles: GPUTextureView
    through: GPUTextureView
    sky: SkyLightReadSet
    cloudShadow: CloudShadowSet
    reflection: GPUTextureView
    fog: FogRead
    lightShaft: GPUTextureView
    occlusion: GPUTextureView
    lightFunction: GPUTextureView
  },
): GPUBindGroupEntry[] {
  return [
    { binding: DEFERRED_BINDINGS.subsurface, resource: surface.subsurfaceView },
    { binding: DEFERRED_BINDINGS.lobes, resource: surface.lobesView },
    ...namedEntries(DEFERRED_BINDINGS, {
      lights: { buffer: r.lights },
      tiles: { buffer: r.tiles },
    }),
    { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: r.mask },
    { binding: DEFERRED_BINDINGS.maskTiles, resource: r.maskTiles },
    { binding: DEFERRED_BINDINGS.transmissionResolve, resource: r.through },
    { binding: DEFERRED_BINDINGS.reflection, resource: r.reflection },
    { binding: DEFERRED_BINDINGS.ambientOcclusion, resource: r.occlusion },
    { binding: DEFERRED_LIGHT_FUNCTION_BINDINGS.atlas, resource: r.lightFunction },
    ...fogReadBindEntries(DEFERRED_FOG_BINDINGS, r.fog, r.lightShaft),
    ...skyLightReadBindEntries(DEFERRED_SKY_LIGHT_BINDINGS, r.sky),
    ...cloudShadowBindEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, r.cloudShadow),
  ]
}
