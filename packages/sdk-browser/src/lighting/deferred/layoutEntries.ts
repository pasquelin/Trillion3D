import { DEFERRED_BINDINGS, DEFERRED_FOG_BINDINGS } from './bindings.ts'
import { fogReadLayoutEntries } from '../fog/read.ts'
import { SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { receiverLayoutEntry } from '../../visibility/passes/receiver.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'
import { MASK_TILES_TARGET } from '../direct/shadowTraceWgsl.ts'
import { REFLECTION_TARGET } from '../reflections/weight.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * Bindings of the deferred pass. The unlit view stops at the surfaces and the uniform; the contract
 * program adds the declared lights, their per-tile lists and the shadow mask the projection traced; the
 * bounce one adds the probe grid. None of the three reads a light written in the scene: there is
 * none left.
 */
export function deferredLayoutEntries(direct: boolean, bounce = false) {
  const fragment = GPUShaderStage.FRAGMENT
  const entries: GPUBindGroupLayoutEntry[] = [
    computeTextureEntry(DEFERRED_BINDINGS.baseMetal, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.normalRough, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.emissiveAo, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.flags, 'uint', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.depth, 'depth', '2d', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', fragment),
  ]
  if (direct)
    entries.push(
      ...contractLayoutEntries(fragment),
      ...maskLayoutEntries(fragment),
      ...resolveLayoutEntries(fragment),
    )
  // Probe grid and their coefficients: bound only by the bounce program, so a session without
  // bounce keeps exactly the previous layout. The coefficients are an atlas (`atlas.ts`): no
  // storage buffer of the eight. The screen probes' result, which the pixels read their indirect
  // light from (`../bounce/screen/indirectWgsl.ts`), is a sampled texture of words read by load: the
  // fifth read-only storage texture of a stage would pass the four a default device holds.
  if (bounce)
    entries.push(
      computeBufferEntry(DEFERRED_BINDINGS.bounceGrid, 'uniform', fragment),
      computeTextureEntry(DEFERRED_BINDINGS.probes, 'unfilterable-float', '2d-array', fragment),
      computeTextureEntry(DEFERRED_BINDINGS.screenIndirect, 'uint', '2d', fragment),
    )
  return entries
}

/** What a contract program adds to the deferred layout: the declared lights, their per-tile lists
 *  and the shadow mask, and the fog's resources. */
function contractLayoutEntries(fragment: number): GPUBindGroupLayoutEntry[] {
  return [
    computeBufferEntry(DEFERRED_BINDINGS.lights, 'read-only-storage', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.tiles, 'read-only-storage', fragment),
    // The shadow mask (`vsmMaskFactor`): the opaque resolve's.
    computeTextureEntry(CONTRACT_SHADOW_BINDINGS.transmittance, 'uint', '2d-array', fragment),
    // The fog's cubemap, volume and frame, which the fog laid over the lit sum reads.
    ...fogReadLayoutEntries(DEFERRED_FOG_BINDINGS, fragment),
  ]
}

/** What a mask read takes beside the mask, the opaque resolve's: the mask's transmission and its
 *  tile words (a read-only storage texture). */
function maskLayoutEntries(fragment: number): GPUBindGroupLayoutEntry[] {
  return [
    computeTextureEntry(
      DEFERRED_BINDINGS.transmissionResolve,
      'unfilterable-float',
      '2d-array',
      fragment,
    ),
    MASK_TILES_TARGET.layoutEntry(),
  ]
}

/**
 * The receiver target, subsurface, lobes and the reflection: only the opaque resolve. The
 * subsurface and the lobes, targets read by load alone, are read-only storage textures: the widest
 * program, with bounce, stays within the sixteen sampled textures WebGPU guarantees a stage.
 */
function resolveLayoutEntries(fragment: number): GPUBindGroupLayoutEntry[] {
  return [
    receiverLayoutEntry(DEFERRED_BINDINGS.receiver, fragment),
    SUBSURFACE_TARGET.layoutEntry(),
    // The anisotropic and clear-coat lobes (`../../materials/surface/physicalLobes.ts`).
    PHYSICAL_LOBES_TARGET.layoutEntry(),
    // The share of the radiance the reflection trace wrote (`../reflections/trace/trace.ts`).
    REFLECTION_TARGET.layoutEntry(),
    // The ambient occlusion the image drew, or its stand-in (`../ao/frame.ts`).
    computeTextureEntry(DEFERRED_BINDINGS.ambientOcclusion, 'unfilterable-float', '2d', fragment),
  ]
}
