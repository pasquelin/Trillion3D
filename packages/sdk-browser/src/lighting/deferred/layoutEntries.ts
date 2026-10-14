import { DEFERRED_BINDINGS } from './bindings.ts'
import { SUBSURFACE_TARGET } from '../../scene/subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { receiverLayoutEntries } from '../../webgpu/visibility/receiver.ts'
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts'
import { CONTRACT_TRACE_BINDINGS, CONTRACT_VSM_BINDINGS } from '../direct/shadowWgsl.ts'
import { REFLECTION_TARGET } from '../../reflections/weight.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * Bindings of the deferred pass. The unlit view stops at the surfaces and the uniform; the contract
 * program adds the declared lights, their per-tile lists and the virtual shadow maps they read; the
 * bounce one adds the probe grid. None of the three reads a light written in the scene: there is
 * none left. The water composite extends the full list with its own bindings, so a surface lit
 * there is read on the same numbers; without `resolve`, it takes the pool in place of the opaque
 * resolve's own entries.
 */
export function deferredLayoutEntries(direct: boolean, bounce = false, resolve = true) {
  const fragment = GPUShaderStage.FRAGMENT
  const entries: GPUBindGroupLayoutEntry[] = [
    computeTextureEntry(DEFERRED_BINDINGS.baseMetal, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.normalRough, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.emissiveAo, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.flags, 'uint', '2d', fragment),
    computeTextureEntry(DEFERRED_BINDINGS.depth, 'depth', '2d', fragment),
    computeBufferEntry(DEFERRED_BINDINGS.view, 'uniform', GPUShaderStage.FRAGMENT),
  ]
  if (direct) entries.push(...contractLayoutEntries())
  // The pool a non-mask read samples, the projection's view and noise its fragments trace with
  // (`vsmTraceFactor`): the water composite's alone, the resolve reading the
  // mask (`directShadowWgsl`), so it holds the eight storage buffers with the receiver's three.
  if (direct && !resolve)
    entries.push(
      {
        binding: CONTRACT_VSM_BINDINGS.pool,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: CONTRACT_TRACE_BINDINGS.view,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      computeTextureEntry(
        CONTRACT_TRACE_BINDINGS.noise,
        'unfilterable-float',
        '2d',
        GPUShaderStage.FRAGMENT,
      ),
    )
  if (direct && resolve) entries.push(...resolveLayoutEntries())
  // Probe grid and their coefficients: bound only by the bounce program, so a session without
  // bounce keeps exactly the previous layout. The coefficients are an atlas (`atlas.ts`): no
  // storage buffer of the eight.
  if (bounce)
    entries.push(
      computeBufferEntry(DEFERRED_BINDINGS.bounceGrid, 'uniform', GPUShaderStage.FRAGMENT),
      computeTextureEntry(
        DEFERRED_BINDINGS.probes,
        'unfilterable-float',
        '2d-array',
        GPUShaderStage.FRAGMENT,
      ),
    )
  return entries
}

/** What a contract program adds to the deferred layout: the declared lights, their per-tile lists,
 *  the virtual shadow maps they read and the shadow mask. */
function contractLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    {
      binding: DEFERRED_BINDINGS.lights,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'read-only-storage' },
    },
    {
      binding: DEFERRED_BINDINGS.tiles,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'read-only-storage' },
    },
    // The virtual shadow maps a non-mask read samples: page table, projection data, uniforms,
    // and the pool's dynamic slice at the translucent depth's number.
    {
      binding: CONTRACT_VSM_BINDINGS.pageTable,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'read-only-storage' },
    },
    {
      binding: CONTRACT_VSM_BINDINGS.projectionData,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'read-only-storage' },
    },
    {
      binding: CONTRACT_VSM_BINDINGS.uniforms,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' },
    },
    // The opaque resolve's compact shadow mask (`vsmMaskFactor`); the water composite's
    // translucent casters' transmission on the same number: both words.
    computeTextureEntry(
      CONTRACT_SHADOW_BINDINGS.transmittance,
      'uint',
      '2d-array',
      GPUShaderStage.FRAGMENT,
    ),
  ]
}

/**
 * The receiver offset's reads, subsurface, lobes, the mask's transmission, table and tiles: only
 * the opaque resolve. The subsurface, the lobes and the mask's table, three targets read by load
 * alone, are read-only storage textures: the widest program, with bounce, stays within the sixteen
 * sampled textures WebGPU guarantees a stage.
 */
function resolveLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    ...receiverLayoutEntries(DEFERRED_BINDINGS.receiver, GPUShaderStage.FRAGMENT),
    SUBSURFACE_TARGET.layoutEntry(),
    // The anisotropic and clear-coat lobes (`../../scene/physicalLobes.ts`).
    PHYSICAL_LOBES_TARGET.layoutEntry(),
    // The translucent casters' transmission (the mask holds the transmittance's number).
    computeTextureEntry(
      DEFERRED_BINDINGS.transmissionResolve,
      'uint',
      '2d-array',
      GPUShaderStage.FRAGMENT,
    ),
    // The share of the radiance the reflection trace wrote (`../../reflections/trace.ts`).
    REFLECTION_TARGET.layoutEntry(),
    computeTextureEntry(DEFERRED_BINDINGS.maskTiles, 'uint', '2d', GPUShaderStage.FRAGMENT),
  ]
}
