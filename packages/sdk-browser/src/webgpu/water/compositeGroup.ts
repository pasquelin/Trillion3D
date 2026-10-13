import { DEFERRED_BINDINGS } from '../../lighting/deferred/bindings.ts'
import { PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { WATER_BINDINGS } from './compositeWgsl.ts'
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts'
import { readOnly } from '../core/bindLayout.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'

/** What the composite's group is made of (`createWaterCompositeLayout`): the frame's targets,
 *  the blend view, the lighting and the verdict whose rectangle the quad covers. */
export type WaterSources = {
  gpu: WebgpuGpuState
  uniform: GPUBuffer
  lighting: BlendLighting
  verdict: GPUBuffer
}
/** A binding's layout past its number, and its stage when the vertex's (the fragment's
 *  otherwise). */
type Layout = Omit<GPUBindGroupLayoutEntry, 'binding' | 'visibility'> & { vertex?: true }
/** One binding of the composite past its surfaces: its number, what it holds, and its layout where
 *  it is the composite's own — else the opaque resolve's on the same number
 *  (`deferredLayoutEntries`), a surface lit there read as the resolve reads it. */
type Held = readonly [binding: number, of: (sources: WaterSources) => unknown, layout?: Layout]

const b = WATER_BINDINGS
/** The composite's bindings past the material surfaces, in one list: the layout
 *  (`waterCompositeLayoutEntries`), the group's entries (`waterCompositeEntries`) and the frame's
 *  identity (`nameWaterResources`) are all made of it. The water word — a colour, in the surface
 *  flags' place —, the water depth, the lights and their shadows — the virtual shadow maps on the
 *  contract's numbers (`CONTRACT_VSM_BINDINGS`), the translucent depth made and dropped with the
 *  transmittance —, what its pixels trace their shadow with (the projection's view and noise), the
 *  probes, the proxy and the culling's records — its worlds and instances — and its tree, the frozen
 *  backdrop and its depth, the blend view, the volumes and, for the vertex stage, the verdict its
 *  quad reads the rectangle from. */
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
  [b.shadowView, ({ lighting }) => lighting.shadowView],
  [b.shadowNoise, ({ lighting }) => lighting.shadowNoise],
  [b.bounceGrid, ({ lighting }) => lighting.bounceGrid],
  [b.probes, ({ lighting }) => lighting.probes],
  [b.proxy, ({ lighting }) => lighting.proxy, { buffer: readOnly }],
  [
    b.proxyWorlds,
    ({ lighting }) => lighting.proxyWorlds,
    { texture: { sampleType: 'uint', viewDimension: '2d-array' } },
  ],
  [
    b.proxyTree,
    ({ lighting }) => lighting.proxyTree,
    { texture: { sampleType: 'uint', viewDimension: '2d-array' } },
  ],
  [
    b.backdrop,
    ({ gpu }) => gpu.backdrop!.colorView,
    { texture: { sampleType: 'unfilterable-float' } },
  ],
  [b.backdropDepth, ({ gpu }) => gpu.depthView, { texture: { sampleType: 'depth' } }],
  [b.uniform, ({ uniform }) => uniform, { buffer: { type: 'uniform' } }],
  [b.volumes, ({ gpu }) => gpu.volumeBuffer, { buffer: readOnly }],
  [b.rect, ({ verdict }) => verdict, { buffer: readOnly, vertex: true }],
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
    ...HELD.map(([binding, , own]) => {
      if (!own) return shared(binding)
      const { vertex, ...layout } = own
      return {
        binding,
        visibility: vertex ? GPUShaderStage.VERTEX : GPUShaderStage.FRAGMENT,
        ...layout,
      }
    }),
    PHYSICAL_LOBES_TARGET.layoutEntry(),
  ]
}

/** Which bindings of `HELD` are buffers, bound whole: read off the layout once, at the first group. */
let buffers: readonly boolean[] | undefined
const buffersOf = () =>
  (buffers ??= waterCompositeLayoutEntries()
    .slice(SURFACES, SURFACES + HELD.length)
    .map((entry) => entry.buffer !== undefined))

/** Writes into `next` (`createWebgpuBindIdentity`) what the frame's water group names: its
 *  surfaces — the material targets and the lobes target — and every binding of `HELD`; not the HDR
 *  target it lights into, an attachment, one of two that take turns. A still frame finds the
 *  same, and allocates nothing: `sources` is the frame's, rewritten in place. */
export function nameWaterResources(next: unknown[], sources: WaterSources) {
  next[0] = sources.gpu.surfaces
  for (let i = 0; i < HELD.length; i++) next[i + 1] = HELD[i][1](sources)
}

/** The composite's bind group entries (`createWaterCompositeLayout`), on the targets `bind` found
 *  (`frame.ts`): the three material surfaces, the bindings of `HELD`, and the lobes target the
 *  lobed stage left, or the opaque resolve (`waterLobesWgsl.ts`). */
export function waterCompositeEntries(sources: WaterSources): GPUBindGroupEntry[] {
  const surfaces = sources.gpu.surfaces!,
    buffer = buffersOf()
  return [
    ...sequentialEntries(surfaces.views().slice(0, SURFACES)),
    ...HELD.map(([binding, of], at) => {
      const held = of(sources)
      return { binding, resource: (buffer[at] ? { buffer: held } : held) as GPUBindingResource }
    }),
    { binding: DEFERRED_BINDINGS.lobes, resource: surfaces.lobesView },
  ]
}
