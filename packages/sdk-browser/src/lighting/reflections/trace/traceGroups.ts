import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { ProxyResources } from '../../../geometry/dag/cut/cutReaders.ts'
import type { FrontLayer } from '../frontLayer.ts'
import type { ReflectionGrids } from '../grids.ts'
import { REFLECTION_TRACE_BINDINGS, traceLayouts } from './traceBindings.ts'

/** What the trace reads of the frame: its surface targets, the lights and the bounce cascades; the
 *  proxy is the reflection group's (`../group.ts`). */
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
  /** The proxy the scene stage's rays walk (`reflectionProxy`). */
  proxy: ProxyResources
}

/** The kernels a surface runs, in their order (`trace.ts`): the screen stage over its tracing tiles
 *  and the clear over the unused ones, the scene stage over the rays the screen stage left, the last
 *  pass's clear over the clear tiles, then the resolve, the accumulation and the last pass over the
 *  resolve tiles. */
export const KERNELS = [
  'screen',
  'clearTracing',
  'scene',
  'clear',
  'resolve',
  'temporal',
  'bilateral',
] as const
type Kernel = (typeof KERNELS)[number]

/** The layouts of the trace's groups 0: the classification's and each kernel's (`traceLayouts`). */
export type TraceLayouts = ReturnType<typeof traceLayouts>

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

/** What a view's trace holds: the target the opaque last pass writes, the resolved pixels both
 *  surfaces resolve into in turn, the opaque surface's grids, the transparents' front layer and its
 *  groups. */
export type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  resolvedView: GPUTextureView
  grids: ReflectionGrids
  front: Pick<FrontLayer, 'views' | 'grids'>
  trace: ReturnType<typeof createTraceGroups>
}

/** The groups of one surface — its targets `surface`, its grids `grids` — over the resolved pixels
 *  `resolved`, for both parities: the classification's and each kernel's, the last pass and its clear
 *  writing `out` through their layouts `last`. */
function surfaceGroups(
  device: GPUDevice,
  layouts: TraceLayouts,
  scene: Named,
  surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  grids: ReflectionGrids,
  resolved: GPUTextureView,
  last: { bilateral: GPUBindGroupLayout; clear: GPUBindGroupLayout; out: Named },
): SurfaceGroups {
  const { flags, normals, lobes } = surface
  const { rays, history } = grids
  const list = (buffer: GPUBuffer) => ({ buffer })
  const field = { bounceGrid: scene.bounceGrid, probes: scene.probes }
  // The ray words sampled (`raysRead`) but by their writers, the classification, the screen stage and
  // the clear of the unused tracing tiles, which bind them as storage.
  const group = (layout: GPUBindGroupLayout, named: Named) =>
    device.createBindGroup({
      layout,
      entries: namedEntries(REFLECTION_TRACE_BINDINGS, {
        flags,
        normals,
        lobes,
        ...(named.rays ? {} : { raysRead: rays }),
        ...named,
      }),
    })
  const parities = (make: (p: number) => GPUBindGroup) => [make(0), make(1)]
  // A group that names no history is the same at both parities: made once, served at both.
  const shared = (group: GPUBindGroup) => [group, group]
  const resolve = list(grids.resolve)
  return {
    // The classification picks the blocks' pixels into the ray words and fills the four lists; the
    // screen stage writes the fresh grid and the rays beside the words, and the partial answers of the
    // rays it left into the scratch, which the scene stage finishes into the fresh grid; the clear of
    // the clear tiles empties the resolved pixels and the history the accumulation writes, the resolve
    // reads the fresh grid into the resolved pixels, the accumulation reads them and the last history
    // into the other, and the last pass reads both.
    classify: shared(
      device.createBindGroup({
        layout: layouts.classify,
        entries: namedEntries(REFLECTION_TRACE_BINDINGS, {
          flags,
          normals,
          lobes,
          bounceGrid: scene.bounceGrid,
          rays,
          tracingOut: list(grids.tracing),
          clearTracingOut: list(grids.clearTracing),
          resolveOut: resolve,
          clearOut: list(grids.clear),
        }),
      }),
    ),
    screen: shared(
      group(layouts.screen, {
        rays,
        ...field,
        tiles: list(grids.tracing),
        traceOut: grids.fresh,
        partialOut: grids.partial,
        rayDataOut: grids.rayData,
        pendingOut: list(grids.pending),
      }),
    ),
    clearTracing: shared(group(layouts.clearTracing, { rays, tiles: list(grids.clearTracing) })),
    scene: shared(
      group(layouts.scene, {
        ...scene,
        traceOut: grids.fresh,
        partialIn: grids.partial,
        pendingIn: list(grids.pending),
      }),
    ),
    clear: parities((p) =>
      group(last.clear, {
        ...field,
        ...last.out,
        tiles: list(grids.clear),
        resolvedOut: resolved,
        historyOut: history[p],
      }),
    ),
    resolve: shared(
      group(layouts.resolve, {
        bounceGrid: scene.bounceGrid,
        tiles: resolve,
        freshIn: grids.fresh,
        rayDataIn: grids.rayData,
        resolvedOut: resolved,
      }),
    ),
    temporal: parities((p) =>
      group(layouts.temporal, {
        tiles: resolve,
        temporalIn: resolved,
        historyIn: history[1 - p],
        historyOut: history[p],
      }),
    ),
    bilateral: parities((p) =>
      group(last.bilateral, {
        ...field,
        ...last.out,
        tiles: resolve,
        bilateralIn: history[p],
      }),
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
  const { device, targetView, resolvedView, grids, trace, front } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(stages, targetView, resolvedView, grids, front.grids, front.views.flags)
  next.push(front.views.normals, front.views.lobes, front.views.traced, inputs.base, inputs.flags)
  next.push(inputs.normals, inputs.lobes, inputs.lights, inputs.lightLists, inputs.bounceGrid)
  next.push(inputs.probes, inputs.proxy.buffer, inputs.proxy.worlds, inputs.proxy.tree)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  // What a ray reads of the scene, the scene stage's: the proxy it walks among it.
  const scene: Named = {
    lights: { buffer: inputs.lights },
    lightLists: { buffer: inputs.lightLists },
    bounceGrid: { buffer: inputs.bounceGrid },
    probes: inputs.probes,
    proxy: { buffer: inputs.proxy.buffer },
    worlds: inputs.proxy.worlds,
    tree: inputs.proxy.tree,
  }
  return (trace.groups = {
    opaque: surfaceGroups(device, layouts, scene, inputs, grids, resolvedView, {
      bilateral: layouts.bilateral,
      clear: layouts.clear,
      out: { lights: { buffer: inputs.lights }, base: inputs.base, target: targetView },
    }),
    front: surfaceGroups(device, layouts, scene, front.views, front.grids, resolvedView, {
      bilateral: layouts.bilateralFront,
      clear: layouts.clearFront,
      out: { frontTarget: front.views.traced },
    }),
  })
}
