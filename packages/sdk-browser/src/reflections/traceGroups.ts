import { namedEntries } from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import type { FrontLayer } from './frontLayer.ts'
import type { ReflectionGrids } from './grids.ts'
import { CLASSIFY_BINDINGS } from './tiles.ts'
import { REFLECTION_TRACE_BINDINGS, traceLayouts } from './traceBindings.ts'

/** What the trace reads of the frame: its surface targets, the lights and the bounce cascades; the
 *  proxy is the reflection group's (`group.ts`). */
export type TraceInputs = {
  base: GPUTextureView
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  /** The light grid's buffer (`bounceLightSlice`). */
  lightLists: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
}

/** The kernels a surface runs over its listed tiles, in their order (`trace.ts`). */
export const KERNELS = ['trace', 'spatial', 'temporal', 'bilateral'] as const
type Kernel = (typeof KERNELS)[number]

/** The layouts of the trace's groups 0: each kernel's (`traceLayouts`) and the classification's. */
export type TraceLayouts = ReturnType<typeof traceLayouts> & { classify: GPUBindGroupLayout }

/** Resources by their names in the table (`REFLECTION_TRACE_BINDINGS`). */
type Named = Partial<Record<keyof typeof REFLECTION_TRACE_BINDINGS, GPUBindingResource>>

/** A surface's groups, the classification's and each kernel's, for each parity of the history's turn
 *  about. */
type SurfaceGroups = Record<Kernel | 'classify', GPUBindGroup[]>

/** A view's trace groups, none made yet, and the parity of its history's turn about. */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as { opaque: SurfaceGroups; front: SurfaceGroups } | undefined,
  parity: 0,
})

/** What a view's trace holds: the target the opaque last pass writes, the opaque surface's grids,
 *  the transparents' front layer, its groups, and the settle's word the classification sets
 *  (`settle.ts`). */
export type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  grids: ReflectionGrids
  front: Pick<FrontLayer, 'views' | 'grids'>
  trace: ReturnType<typeof createTraceGroups>
  settle: { sampled: GPUBuffer }
}

/** The groups of one surface — its targets `surface`, its grids `grids` —, for both parities: the
 *  classification's, which sets the settle's word `sampled`, and each kernel's, the last one's
 *  writing `out` through `last`. */
function surfaceGroups(
  device: GPUDevice,
  layouts: TraceLayouts,
  scene: Named,
  sampled: GPUBindingResource,
  surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  grids: ReflectionGrids,
  last: { layout: GPUBindGroupLayout; out: Named },
): SurfaceGroups {
  const { flags, normals, lobes } = surface
  const tiles = { buffer: grids.tiles }
  const group = (layout: GPUBindGroupLayout, named: Named) =>
    device.createBindGroup({
      layout,
      entries: namedEntries(REFLECTION_TRACE_BINDINGS, { normals, lobes, tiles, ...named }),
    })
  const parities = (make: (p: number) => GPUBindGroup) => [make(0), make(1)]
  return {
    // The classification lists the tiles and clears the fresh grid and the scratch elsewhere; the
    // trace writes the grid that is not the history and the rays, the spatial reuse reads them into
    // the scratch, the accumulation reads the scratch and the history into it again, and the last
    // pass reads it.
    classify: parities((p) =>
      device.createBindGroup({
        layout: layouts.classify,
        entries: namedEntries(CLASSIFY_BINDINGS, {
          flags,
          list: tiles,
          fresh: grids.turn[p],
          scratch: grids.scratch,
          sampled,
        }),
      }),
    ),
    trace: parities((p) =>
      group(layouts.trace, { ...scene, flags, traceOut: grids.turn[p], raysOut: grids.rays }),
    ),
    spatial: parities((p) =>
      group(layouts.spatial, {
        spatialIn: grids.turn[p],
        raysIn: grids.rays,
        spatialOut: grids.scratch,
      }),
    ),
    temporal: parities((p) =>
      group(layouts.temporal, {
        flags,
        temporalIn: grids.scratch,
        historyIn: grids.turn[1 - p],
        historyOut: grids.turn[p],
      }),
    ),
    bilateral: parities((p) =>
      group(last.layout, { ...last.out, flags, bilateralIn: grids.turn[p] }),
    ),
  }
}

/** The bind groups of `reflection`'s trace over `inputs` on `layouts`, made again when a resource
 *  they name is not the one they were made over (`stages`, the pipelines they serve, among them). */
export function traceGroups(
  reflection: TraceResources,
  stages: object,
  layouts: TraceLayouts,
  inputs: TraceInputs,
) {
  const { device, targetView, grids, trace, front, settle } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(stages, targetView, grids, front.grids, front.views.flags, front.views.normals)
  next.push(front.views.lobes, front.views.traced, inputs.base, inputs.flags, inputs.normals)
  next.push(inputs.lobes, inputs.lights, inputs.lightLists, inputs.bounceGrid, inputs.probes)
  next.push(settle.sampled)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  // What a ray reads of the scene, the trace's.
  const scene: Named = {
    lights: { buffer: inputs.lights },
    lightLists: { buffer: inputs.lightLists },
    bounceGrid: { buffer: inputs.bounceGrid },
    probes: inputs.probes,
  }
  const sampled = { buffer: settle.sampled }
  return (trace.groups = {
    opaque: surfaceGroups(device, layouts, scene, sampled, inputs, grids, {
      layout: layouts.bilateral,
      out: { lights: { buffer: inputs.lights }, base: inputs.base, target: targetView },
    }),
    front: surfaceGroups(device, layouts, scene, sampled, front.views, front.grids, {
      layout: layouts.bilateralFront,
      out: { frontTarget: front.views.traced },
    }),
  })
}
