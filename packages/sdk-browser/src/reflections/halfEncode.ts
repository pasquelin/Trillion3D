import { namedEntries } from '../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_GROUP } from './viewLayout.ts'
import type { FrontLayer } from './frontLayer.ts'
import { sceneBindEntries } from '../bounce/sceneBindings.ts'
import { REFLECTION_TRACE_BINDINGS, TRACE_SCENE_BINDINGS, halfLayouts } from './halfBindings.ts'
import { halfExtent, type HalfGrids } from './halfTexture.ts'

/** What the trace reads of the frame: its surface targets, the lights, the bounce cascades and the
 *  resident proxy. */
export type TraceInputs = {
  base: GPUTextureView
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  /** The light grid's buffer, whose world lists the proxy hits walk (`bounceLightSlice`). */
  lightLists: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  /** The proxy's buffers, or the empty one in each place (`gpu/dag/proxyInstances.ts`). */
  proxy: GPUBuffer
  /** The culling's records, the worlds the proxy places its meshes by and its instances
   *  (`gpu/dag/worldTable.ts`), or the stand-in. */
  proxyWorlds: GPUTextureView
  /** The culling's placement tree the proxy's rays walk (`gpu/dag/treeTable.ts`), or the stand-in. */
  proxyTree: GPUTextureView
}

const KERNELS = ['trace', 'spatial', 'temporal', 'upsample'] as const
type Kernel = (typeof KERNELS)[number]

/** The reflections' kernels on their module (`REFLECTION_TRACE_SHADER`), each surface's, over the
 *  reflection group's layout `groupLayout` (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  module: GPUShaderModule,
  groupLayout: GPUBindGroupLayout,
) {
  const layouts = halfLayouts(device)
  const stage = (layout: GPUBindGroupLayout, entry: string, constants?: Record<string, number>) =>
    buildComputeStages(device, [layout, groupLayout], module, [entry], constants).then(
      (s) => s[entry],
    )
  // The surface's layer, the pipeline's (`REFLECTION_LAYER_WGSL`): 0 the opaque, 1 the front.
  const [opaque, front] = await Promise.all(
    (['Opaque', 'Front'] as const).map(async (side, layer) => ({
      trace: await stage(layouts.trace, 'traceSurface', { REFLECTION_LAYER: layer }),
      spatial: await stage(layouts.spatial, 'spatialSurface', { REFLECTION_LAYER: layer }),
      temporal: await stage(layouts.temporal, 'temporalSurface', { REFLECTION_LAYER: layer }),
      upsample: await stage(
        side === 'Opaque' ? layouts.upsample : layouts.upsampleFront,
        `upsample${side}`,
      ),
    })),
  )
  return { layouts, opaque, front }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** Resources by their names in the table (`REFLECTION_TRACE_BINDINGS`). */
type Named = Partial<Record<keyof typeof REFLECTION_TRACE_BINDINGS, GPUBindingResource>>

/** A surface's groups, each kernel's for each parity of the history's turn about. */
type SurfaceGroups = Record<Kernel, GPUBindGroup[]>

/** A view's trace groups, none made yet, and the parity of its history's turn about. */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as { opaque: SurfaceGroups; front: SurfaceGroups } | undefined,
  parity: 0,
})

/** What a view's trace holds: the target the upsample writes, the opaque surface's half grids, the
 *  transparents' front layer, its groups, and the settle's word the trace sets (`settle.ts`). */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  half: HalfGrids
  front: Pick<FrontLayer, 'views' | 'half'>
  trace: ReturnType<typeof createTraceGroups>
  settle: { sampled: GPUBuffer }
}

/** The groups of one surface — its targets `surface`, its grids `grids` —, for both parities; the
 *  trace's also set the settle's word `sampled`. */
function surfaceGroups(
  device: GPUDevice,
  layouts: TraceStages['layouts'],
  scene: Named,
  proxy: GPUBindGroupEntry[],
  sampled: GPUBindingResource,
  surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  grids: HalfGrids,
  upsample: { layout: GPUBindGroupLayout; out: Named },
): SurfaceGroups {
  // The flags only the trace and the upsamples read (`halfLayouts`).
  const { flags, normals, lobes } = surface
  const group = (layout: GPUBindGroupLayout, named: Named, more: GPUBindGroupEntry[] = []) =>
    device.createBindGroup({
      layout,
      entries: [...namedEntries(REFLECTION_TRACE_BINDINGS, { normals, lobes, ...named }), ...more],
    })
  // What a ray reads, the trace's and the upsamples': the scene, the proxy and the flags.
  const ray = (layout: GPUBindGroupLayout, named: Named) =>
    group(layout, { ...scene, flags, ...named }, proxy)
  return {
    // The trace writes the grid that is not the history, the spatial reuse reads it into the scratch,
    // the accumulation reads the scratch and the history into it again, which the upsample reads.
    trace: [0, 1].map((p) => ray(layouts.trace, { sampled, traceOut: grids.turn[p] })),
    spatial: [0, 1].map((p) =>
      group(layouts.spatial, { spatialIn: grids.turn[p], spatialOut: grids.scratch }),
    ),
    temporal: [0, 1].map((p) =>
      group(layouts.temporal, {
        temporalIn: grids.scratch,
        historyIn: grids.turn[1 - p],
        historyOut: grids.turn[p],
      }),
    ),
    upsample: [0, 1].map((p) =>
      ray(upsample.layout, { ...upsample.out, upsampleIn: grids.turn[p] }),
    ),
  }
}

/** The bind groups of `reflection`'s trace over `inputs`, made again when a resource they name is
 *  not the one they were made over. */
function traceGroups(reflection: TraceResources, stages: TraceStages, inputs: TraceInputs) {
  const { device, targetView, half, trace, front, settle } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(stages, targetView, half, front.half, front.views.flags, front.views.normals)
  next.push(front.views.lobes, front.views.traced, inputs.base, inputs.flags, inputs.normals)
  next.push(inputs.lobes, inputs.lights, inputs.lightLists, inputs.bounceGrid, inputs.probes)
  next.push(inputs.proxy, inputs.proxyWorlds, inputs.proxyTree, settle.sampled)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  const { layouts } = stages
  // What a ray reads of the scene, the trace's and the upsamples' (an edge pixel's own ray).
  const scene: Named = {
    lights: { buffer: inputs.lights },
    lightLists: { buffer: inputs.lightLists },
    bounceGrid: { buffer: inputs.bounceGrid },
    probes: inputs.probes,
  }
  const proxy = sceneBindEntries(TRACE_SCENE_BINDINGS, {
    buffer: inputs.proxy,
    worlds: inputs.proxyWorlds,
    tree: inputs.proxyTree,
  })
  const sampled = { buffer: settle.sampled }
  return (trace.groups = {
    opaque: surfaceGroups(device, layouts, scene, proxy, sampled, inputs, half, {
      layout: layouts.upsample,
      out: { base: inputs.base, target: targetView },
    }),
    front: surfaceGroups(device, layouts, scene, proxy, sampled, front.views, front.half, {
      layout: layouts.upsampleFront,
      out: { frontTarget: front.views.traced },
    }),
  })
}

/**
 * The reflections of the pixels of `size`, in the open compute `pass` (`traceHalf.ts`): the opaque
 * surface's half grid traced, reused across neighbours, accumulated and upsampled into the reflection
 * target; with `front`, the
 * image's front pass having written a reflecting surface, the front surface's the same way. `depthGroup`
 * is the reflection group over the depth pyramid. The history's parity turns every call.
 */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  front: boolean,
) {
  const groups = traceGroups(reflection, stages, inputs)
  const parity = (reflection.trace.parity ^= 1)
  const half = halfExtent(size[0], size[1])
  pass.setBindGroup(REFLECTION_GROUP, depthGroup)
  const surface = (side: 'opaque' | 'front') => {
    for (const kernel of KERNELS) {
      const [w, h] = kernel === 'upsample' ? size : half
      pass.setPipeline(stages[side][kernel])
      pass.setBindGroup(0, groups[side][kernel][parity])
      pass.dispatchWorkgroups(ceilDiv(w, REFLECTION_SIDE), ceilDiv(h, REFLECTION_SIDE))
    }
  }
  surface('opaque')
  if (front) surface('front')
}
