import { namedEntries } from '../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from './constants.ts'
import type { FrontLayer } from './frontLayer.ts'
import { REFLECTION_TRACE_BINDINGS, halfLayouts } from './halfBindings.ts'
import type { HalfGrids } from './halfTexture.ts'

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

const KERNELS = ['trace', 'temporal', 'upsample'] as const
type Kernel = (typeof KERNELS)[number]

/** The reflections' kernels on their module (`REFLECTION_TRACE_SHADER`), each surface's, over the
 *  reflection group's layout `groupLayout` (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  module: GPUShaderModule,
  groupLayout: GPUBindGroupLayout,
) {
  const layouts = halfLayouts(device)
  const stage = (layout: GPUBindGroupLayout, entry: string) =>
    buildComputeStages(device, [layout, groupLayout], module, [entry]).then((s) => s[entry])
  const [opaque, front] = await Promise.all(
    (['Opaque', 'Front'] as const).map(async (side) => ({
      trace: await stage(layouts.trace, `trace${side}`),
      temporal: await stage(layouts.temporal, `temporal${side}`),
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

/** A surface's groups: the trace's, and the temporal's and the upsample's of each parity. */
type SurfaceGroups = Record<Kernel, GPUBindGroup[]>

/** A view's trace groups, none made yet, and the parity of its history's turn about. */
export const createTraceGroups = () => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as { opaque: SurfaceGroups; front: SurfaceGroups } | undefined,
  parity: 0,
})

/** What a view's trace holds: the target the upsample writes, the opaque surface's half grids, the
 *  transparents' front layer and its groups. */
type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  half: HalfGrids
  front: Pick<FrontLayer, 'views' | 'half'>
  trace: ReturnType<typeof createTraceGroups>
}

/** The groups of one surface — its targets `surface`, its grids `grids` —, for both parities. */
function surfaceGroups(
  device: GPUDevice,
  layouts: TraceStages['layouts'],
  inputs: TraceInputs,
  surface: Named,
  grids: HalfGrids,
  upsample: { layout: GPUBindGroupLayout; out: Named },
): SurfaceGroups {
  const group = (layout: GPUBindGroupLayout, named: Named) =>
    device.createBindGroup({
      layout,
      entries: namedEntries(REFLECTION_TRACE_BINDINGS, { ...surface, ...named }),
    })
  const lights = { buffer: inputs.lights }
  return {
    trace: [
      group(layouts.trace, {
        lights,
        lightLists: { buffer: inputs.lightLists },
        bounceGrid: { buffer: inputs.bounceGrid },
        probes: inputs.probes,
        proxy: { buffer: inputs.proxy },
        proxyWorlds: inputs.proxyWorlds,
        proxyTree: inputs.proxyTree,
        traceOut: grids.scratch,
      }),
    ],
    temporal: [0, 1].map((p) =>
      group(layouts.temporal, {
        temporalIn: grids.scratch,
        historyIn: grids.turn[1 - p],
        historyOut: grids.turn[p],
      }),
    ),
    upsample: [0, 1].map((p) =>
      group(upsample.layout, { ...upsample.out, upsampleIn: grids.turn[p] }),
    ),
  }
}

/** A surface's targets the kernels read, by their names in the table. */
const surfaceOf = (views: {
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
}): Named => ({
  flags: views.flags,
  normals: views.normals,
  lobes: views.lobes,
})

/** The bind groups of `reflection`'s trace over `inputs`, made again when a resource they name is
 *  not the one they were made over. */
function traceGroups(reflection: TraceResources, stages: TraceStages, inputs: TraceInputs) {
  const { device, targetView, half, trace, front } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(stages, targetView, half, front.half, front.views.flags, front.views.normals)
  next.push(front.views.lobes, front.views.traced, inputs.base, inputs.flags, inputs.normals)
  next.push(inputs.lobes, inputs.lights, inputs.lightLists, inputs.bounceGrid, inputs.probes)
  next.push(inputs.proxy, inputs.proxyWorlds, inputs.proxyTree)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  const { layouts } = stages
  return (trace.groups = {
    opaque: surfaceGroups(device, layouts, inputs, surfaceOf(inputs), half, {
      layout: layouts.upsample,
      out: { lights: { buffer: inputs.lights }, base: inputs.base, target: targetView },
    }),
    front: surfaceGroups(device, layouts, inputs, surfaceOf(front.views), front.half, {
      layout: layouts.upsampleFront,
      out: { frontTarget: front.views.traced },
    }),
  })
}

/**
 * The reflections of the pixels of `size`, in the open compute `pass` (`traceHalf.ts`): the opaque
 * surface's half grid traced, accumulated and upsampled into the reflection target; with `front`, the
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
  pass.setBindGroup(1, depthGroup)
  const surface = (side: 'opaque' | 'front') => {
    for (const kernel of KERNELS) {
      const cells = kernel === 'upsample' ? 1 : 2
      pass.setPipeline(stages[side][kernel])
      pass.setBindGroup(0, groups[side][kernel][kernel === 'trace' ? 0 : parity])
      pass.dispatchWorkgroups(
        ceilDiv(ceilDiv(size[0], cells), REFLECTION_SIDE),
        ceilDiv(ceilDiv(size[1], cells), REFLECTION_SIDE),
      )
    }
  }
  surface('opaque')
  if (front) surface('front')
}
