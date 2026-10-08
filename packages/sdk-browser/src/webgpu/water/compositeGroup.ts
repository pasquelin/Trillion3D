import { PHYSICAL_LOBES_BINDING, PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { WATER_BINDINGS } from './compositeWgsl.ts'
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts'
import { readOnly } from '../core/bindLayout.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'

/** What the composite's group is made of (`createWaterCompositeLayout`). */
type Sources = { gpu: WebgpuGpuState; uniform: GPUBuffer; lighting: BlendLighting }
/** A binding's layout past its number and stage, the fragment's. */
type Layout = Omit<GPUBindGroupLayoutEntry, 'binding' | 'visibility'>
/** One binding of the composite past its surfaces: its number, what it holds, and its layout where
 *  it is the composite's own — else the opaque resolve's on the same number
 *  (`deferredLayoutEntries`), a surface lit there read as the resolve reads it. */
type Held = readonly [binding: number, of: (sources: Sources) => unknown, layout?: Layout]

const b = WATER_BINDINGS
/** The composite's bindings past the material surfaces, in one list: the layout
 *  (`waterCompositeLayoutEntries`), the group's entries (`waterCompositeEntries`) and the frame's
 *  identity (`nameWaterResources`) are all made of it. The water word — a colour, in the surface
 *  flags' place —, the water depth, the lights and their shadows — the virtual shadow maps on the
 *  contract's numbers (`CONTRACT_VSM_BINDINGS`), the translucent depth made and dropped with the
 *  transmittance —, the probes and the proxy, the frozen backdrop and its depth, the blend view
 *  and the volumes. */
const HELD: readonly Held[] = [
  [b.word, ({ gpu }) => gpu.colorView, { texture: { sampleType: 'unfilterable-float' } }],
  [b.depth, ({ gpu }) => gpu.backdrop!.waterDepthView],
  [b.view, ({ gpu }) => gpu.deferred?.uniform],
  [b.directLights, ({ lighting }) => lighting.directLights],
  [b.tileLights, ({ lighting }) => lighting.tileLights],
  [b.shadowData, ({ lighting }) => lighting.shadowData],
  [b.shadowAtlas, ({ lighting }) => lighting.shadowAtlas],
  [b.shadowSampler, ({ lighting }) => lighting.shadowSampler],
  [b.shadowTransmittance, ({ lighting }) => lighting.shadowTransmittance],
  [b.shadowTranslucentDepth, ({ lighting }) => lighting.shadowTranslucentDepth],
  [b.bounceGrid, ({ lighting }) => lighting.bounceGrid],
  [b.probes, ({ lighting }) => lighting.probes],
  [b.proxy, ({ lighting }) => lighting.proxy],
  [b.surface, ({ lighting }) => lighting.surfaceCache],
  [
    b.backdrop,
    ({ gpu }) => gpu.backdrop!.colorView,
    { texture: { sampleType: 'unfilterable-float' } },
  ],
  [b.backdropDepth, ({ gpu }) => gpu.depthView, { texture: { sampleType: 'depth' } }],
  [b.uniform, ({ uniform }) => uniform, { buffer: { type: 'uniform' } }],
  [b.volumes, ({ gpu }) => gpu.volumeBuffer, { buffer: readOnly }],
]

/** The material surfaces the composite reads first, on the resolve's numbers. */
const SURFACES = 3

/**
 * The composite's layout, made of `HELD`: the three material surfaces, each binding of `HELD` on
 * its own layout or the opaque resolve's (the deferred bounce layout with the pool,
 * `deferredLayoutEntries`), and the lobes target its lobed programs read (`waterLobesWgsl.ts`), a
 * read-only storage texture as in the opaque resolve. A binding of `HELD` the resolve does not hold
 * and the composite does not lay out throws: no binding bound and not laid out.
 */
export function waterCompositeLayoutEntries(): GPUBindGroupLayoutEntry[] {
  const resolve = deferredLayoutEntries(true, true, false)
  const shared = (binding: number) => {
    const entry = resolve.find((held) => held.binding === binding)
    if (!entry) throw new Error(`WATER_BINDING_UNLAID_${binding}`)
    return entry
  }
  return [
    ...resolve.filter(({ binding }) => binding < SURFACES),
    ...HELD.map(([binding, , own]) =>
      own ? { binding, visibility: GPUShaderStage.FRAGMENT, ...own } : shared(binding),
    ),
    PHYSICAL_LOBES_TARGET.layoutEntry(),
  ]
}

/** Which bindings of `HELD` are buffers, bound whole: read off the layout once, at the first group. */
let buffers: readonly boolean[] | undefined
const buffersOf = () =>
  (buffers ??= waterCompositeLayoutEntries()
    .slice(SURFACES, SURFACES + HELD.length)
    .map((entry) => entry.buffer !== undefined))

/** The sources the frame names, reused: naming them allocates nothing. */
const named = {} as Sources

/** Writes into `next` (`createWebgpuBindIdentity`) what the frame's water pass names: its surfaces
 *  — the material targets and the lobes target —, its colour target and every binding of `HELD`. A
 *  still frame finds the same, and allocates nothing. */
export function nameWaterResources(
  next: unknown[],
  gpu: WebgpuGpuState,
  uniform: GPUBuffer,
  lighting: BlendLighting,
) {
  named.gpu = gpu
  named.uniform = uniform
  named.lighting = lighting
  next[0] = gpu.surfaces
  next[1] = gpu.hdrView
  for (let i = 0; i < HELD.length; i++) next[i + 2] = HELD[i][1](named)
}

/** The composite's bind group entries (`createWaterCompositeLayout`), on the targets `bind` found
 *  (`frame.ts`): the three material surfaces, the bindings of `HELD`, and the lobes target the
 *  lobed stage left, or the opaque resolve (`waterLobesWgsl.ts`). */
export function waterCompositeEntries(
  gpu: WebgpuGpuState,
  uniform: GPUBuffer,
  lighting: BlendLighting,
): GPUBindGroupEntry[] {
  const surfaces = gpu.surfaces!,
    sources = { gpu, uniform, lighting },
    buffer = buffersOf()
  return [
    ...surfaces
      .views()
      .slice(0, SURFACES)
      .map((resource, binding) => ({ binding, resource })),
    ...HELD.map(([binding, of], at) => {
      const held = of(sources)
      return { binding, resource: (buffer[at] ? { buffer: held } : held) as GPUBindingResource }
    }),
    { binding: PHYSICAL_LOBES_BINDING, resource: surfaces.lobesView },
  ]
}
