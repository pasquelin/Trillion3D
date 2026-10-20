import { DEFERRED_BINDINGS } from './bindings.ts'
import { SUBSURFACE_TARGET } from '../../scene/subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { receiverLayoutEntry } from '../../webgpu/visibility/receiver.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/shadowBindings.ts'
import { MASK_TILES_TARGET } from '../direct/shadowTraceWgsl.ts'
import { REFLECTION_TARGET } from '../../reflections/weight.ts'
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
  // storage buffer of the eight.
  if (bounce)
    entries.push(
      computeBufferEntry(DEFERRED_BINDINGS.bounceGrid, 'uniform', fragment),
      computeTextureEntry(DEFERRED_BINDINGS.probes, 'unfilterable-float', '2d-array', fragment),
    )
  return entries
}

/** What a contract program adds to the deferred layout: the declared lights, their per-tile lists
 *  and the shadow mask. */
function contractLayoutEntries(fragment: number): GPUBindGroupLayoutEntry[] {
  return [
    computeBufferEntry(DEFERRED_BINDINGS.lights, 'read-only-storage', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.tiles, 'read-only-storage', fragment),
    // The shadow mask (`vsmMaskFactor`): the opaque resolve's.
    computeTextureEntry(CONTRACT_SHADOW_BINDINGS.transmittance, 'uint', '2d-array', fragment),
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
    // The anisotropic and clear-coat lobes (`../../scene/physicalLobes.ts`).
    PHYSICAL_LOBES_TARGET.layoutEntry(),
    // The share of the radiance the reflection trace wrote (`../../reflections/trace.ts`).
    REFLECTION_TARGET.layoutEntry(),
  ]
}
