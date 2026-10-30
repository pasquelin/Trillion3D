import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { GlobalFieldRead } from '../../distanceField/view.ts'
import type { FrontLayer } from '../frontLayer.ts'
import type { ReflectionCensus } from '../census.ts'
import type { ReflectionGrids } from '../grids.ts'
import { surfaceHitEntries, type SurfaceHitResources } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { LightProfileResources } from '../../lightProfile/profileBindings.ts'
import { createHardwareTraceGroups } from './traceHardwareGroups.ts'
import { rayFogBindEntries, type RayFogRead } from '../rayFog.ts'
import {
  REFLECTION_FOG_BINDINGS,
  REFLECTION_HIT_BINDINGS,
  REFLECTION_TRACE_BINDINGS,
  traceLayouts,
} from './traceBindings.ts'

/** What the trace reads of the frame: its surface targets, the lights, the global
 *  distance field its scene stage marches and the surface cache its hits are read in. */
export type TraceInputs = {
  flags: GPUTextureView
  normals: GPUTextureView
  lobes: GPUTextureView
  lights: GPUBuffer
  /** The fog's own cubemap and the sampler it is read through, which tint the height fog the scene stage lays over a ray (`reflectionFogged`):
   *  the stand-in white cube while the fog has none. */
  fog: RayFogRead
  /** The global distance field the scene stage's rays are marched through (`reflectionField`). */
  field: GlobalFieldRead
  /** The surface cache and the object grid the scene stage's hits are read in (`createHitCards().resources`). */
  hit: SurfaceHitResources
  /** The surfaces' vectors of the image, which the accumulation reprojects a moving surface's history by
   *  (`../../bounce/screen/vectorSource.ts`); the view's stand-in of none where the velocity stage drew none. */
  vectors: GPUTextureView
  /** The blue noise the ray generation draws a ray's direction from (`noiseViewOn`: the engine's, a stand-in until it is made). */
  blue: GPUTextureView
  /** The atlas of the light functions and the one of the light profiles the hit lighting's first pass reads (`litDirect`): the stand-ins while the scene has none. */
  lightFunction: GPUTextureView
  lightProfile: LightProfileResources
  /** The scene trace the image's lighting made for rays through the scene's triangles (`sceneRaysOf`), where the scene stage casts them: none otherwise. */
  rays?: SceneRays
}

/** The kernels a surface runs, in their order (`trace.ts`): the ray generation and the screen stage over its tracing tiles
 *  and the clear over the unused ones, the scene stage over the rays the screen stage missed, the last
 *  pass's clear over the clear tiles, then the resolve, the accumulation and the last pass over the
 *  resolve tiles. */
export const KERNELS = [
  'generate',
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
type SurfaceGroups = Record<Kernel | 'classify' | 'meshCompact' | 'meshTrace', GPUBindGroup[]>

/** A view's trace groups, none made yet, and the parity of its history's turn about. */
export const createTraceGroups = (device: GPUDevice) => ({
  identity: createWebgpuBindIdentity(),
  groups: undefined as
    { opaque: SurfaceGroups; front: SurfaceGroups; keepDepth: GPUBindGroup } | undefined,
  parity: 0,
  /** The groups of the scene stage that casts its rays through the scene's triangles (`traceHardwareGroups.ts`). */
  hardware: createHardwareTraceGroups(device),
})

/** What a view's trace holds: the target the opaque last pass writes, the resolved pixels both
 *  surfaces resolve into in turn, the opaque surface's grids, the counters its rays add to
 *  (`../census.ts`, none where nothing is counted), the transparents' front layer and its groups. */
export type TraceResources = {
  device: GPUDevice
  targetView: GPUTextureView
  resolvedView: GPUTextureView
  /** The opaque depth of the last image the trace ran on (`../past.ts`). */
  depthView: GPUTextureView
  grids: ReflectionGrids
  census: ReflectionCensus
  front: Pick<FrontLayer, 'views' | 'grids'>
  trace: ReturnType<typeof createTraceGroups>
}

/** A buffer as a binding resource. */
const list = (buffer: GPUBuffer) => ({ buffer })

/** The classification's group: the surface's pixels and the four lists it fills. */
function classifyGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  grids: ReflectionGrids,
) {
  return device.createBindGroup({
    layout,
    entries: namedEntries(REFLECTION_TRACE_BINDINGS, {
      flags: surface.flags,
      normals: surface.normals,
      lobes: surface.lobes,
      tracingOut: list(grids.tracing),
      clearTracingOut: list(grids.clearTracing),
      resolveOut: list(grids.resolve),
      clearOut: list(grids.clear),
    }),
  })
}

/** What the groups of one surface are made over. */
interface SurfaceKit {
  readonly device: GPUDevice
  readonly layouts: TraceLayouts
  readonly scene: Named
  readonly surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView }
  readonly grids: ReflectionGrids
  readonly resolved: GPUTextureView
  /** The surfaces' vectors of the image, and the depth of the last image: where a screen hit stood in it (`../past.ts`). */
  readonly past: Named
  readonly field: Named
  /** A group over `layout` naming `named` and `more`. The rays are sampled (`raysRead`) but by their
   *  writers and readers as storage, the ray generation, the screen and scene stages and the clear of the unused tracing tiles. */
  readonly group: (
    layout: GPUBindGroupLayout,
    named: Named,
    more?: GPUBindGroupEntry[],
  ) => GPUBindGroup
}

const parities = (make: (p: number) => GPUBindGroup) => [make(0), make(1)]
// A group that names no history is the same at both parities: made once, served at both.
const shared = (group: GPUBindGroup) => [group, group]

/** The groups of the classification and of the kernels that trace: the ray generation, the screen stage, the clear of the
 *  unused tracing tiles and the scene stage. */
function tracingGroups(kit: SurfaceKit, sceneEntries: GPUBindGroupEntry[]) {
  const { device, layouts, scene, surface, grids, field, past, group } = kit
  const { rays } = grids
  return {
    // The classification fills the four lists; the ray generation draws the rays of the texels of the tracing tiles into the ray texture;
    // the screen stage — reading them as the storage they are written through — writes the fresh grid of the rays it hit and lists the rays it
    // missed, which the scene stage finishes into the fresh grid.
    classify: shared(classifyGroup(device, layouts.classify, surface, grids)),
    generate: shared(
      group(layouts.generate, {
        rays,
        ...field,
        tiles: list(grids.tracing),
        blue: scene.blue,
      }),
    ),
    screen: shared(
      group(layouts.screen, {
        rays,
        ...field,
        ...past,
        tiles: list(grids.tracing),
        traceOut: grids.fresh,
        pendingOut: list(grids.pending),
        ...(scene.census && { census: scene.census }),
      }),
    ),
    clearTracing: shared(group(layouts.clearTracing, { rays, tiles: list(grids.clearTracing) })),
    scene: shared(
      group(
        layouts.scene,
        {
          lights: scene.lights,
          ...(scene.census && { census: scene.census }),
          ...past,
          rays,
          traceOut: grids.fresh,
          pendingIn: list(grids.pending),
        },
        sceneEntries,
      ),
    ),
    // The meshes' fields stage (`meshes.ts`): the list of the rays the screen missed, bound to write, and what its trace writes and reads.
    meshCompact: shared(group(layouts.meshCompact, { rays, pendingMesh: list(grids.pending) })),
    meshTrace: shared(
      group(
        layouts.meshTrace,
        { lights: scene.lights, rays, traceOut: grids.fresh, pendingMesh: list(grids.pending) },
        sceneEntries,
      ),
    ),
  }
}

/** The groups of the kernels that resolve: the clear of the clear tiles empties the resolved pixels and
 *  the history the accumulation writes, the resolve reads the fresh grid into the resolved pixels, the
 *  accumulation reads them and the last history into the other, and the last pass reads both. */
function resolvingGroups(
  kit: SurfaceKit,
  vectors: GPUTextureView,
  last: { bilateral: GPUBindGroupLayout; clear: GPUBindGroupLayout; out: Named },
) {
  const { layouts, grids, resolved, field, group } = kit
  const { history } = grids
  const resolve = list(grids.resolve)
  return {
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
        ...field,
        tiles: resolve,
        freshIn: grids.fresh,
        resolvedOut: resolved,
      }),
    ),
    temporal: parities((p) =>
      group(layouts.temporal, {
        tiles: resolve,
        temporalIn: resolved,
        vectors,
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

/** The groups of one surface — its targets `surface`, its grids `grids` — over the resolved pixels
 *  `resolved`, for both parities: the classification's and each kernel's, the last pass and its clear
 *  writing `out` through their layouts `last`. */
function surfaceGroups(
  device: GPUDevice,
  layouts: TraceLayouts,
  scene: Named,
  sceneEntries: GPUBindGroupEntry[],
  surface: { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView },
  grids: ReflectionGrids,
  resolved: GPUTextureView,
  vectors: GPUTextureView,
  depth: GPUTextureView,
  last: { bilateral: GPUBindGroupLayout; clear: GPUBindGroupLayout; out: Named },
): SurfaceGroups {
  const { flags, normals, lobes } = surface
  const { rays } = grids
  const kit: SurfaceKit = {
    device,
    layouts,
    scene,
    surface,
    grids,
    resolved,
    past: { vectors, depthHistory: depth },
    field: { lights: scene.lights },
    group: (layout, named, more = []) =>
      device.createBindGroup({
        layout,
        entries: [
          ...namedEntries(REFLECTION_TRACE_BINDINGS, {
            flags,
            normals,
            lobes,
            ...(named.rays ? {} : { raysRead: rays }),
            ...named,
          }),
          ...more,
        ],
      }),
  }
  return { ...tracingGroups(kit, sceneEntries), ...resolvingGroups(kit, vectors, last) }
}

/** The resources the trace's groups name, recorded in the identity they are made again when it moves. */
function recordGroupInputs(reflection: TraceResources, stages: object, inputs: TraceInputs) {
  const { targetView, resolvedView, depthView, grids, trace, front, census } = reflection
  const { next } = trace.identity
  next.length = 0
  next.push(
    stages,
    targetView,
    resolvedView,
    depthView,
    grids,
    front.grids,
    front.views.flags,
    census.buffer,
  )
  next.push(front.views.normals, front.views.lobes, front.views.traced, inputs.flags)
  next.push(inputs.normals, inputs.lobes, inputs.lights)
  next.push(inputs.fog.cubemap, inputs.fog.sampler)
  next.push(inputs.field, inputs.field.readGeneration, inputs.vectors, inputs.blue)
  const { hit } = inputs
  next.push(hit.tables, hit.depth, hit.final, hit.feedback, hit.grid, hit.instances)
}

/** The bind groups of `reflection`'s trace over `inputs` on `layouts`, made again when a resource
 *  they name is not the one they were made over (`stages`, the pipelines they serve, among them). */
export function traceGroups(
  reflection: TraceResources,
  stages: object,
  layouts: TraceLayouts,
  inputs: TraceInputs,
) {
  const { device, targetView, resolvedView, depthView, grids, trace, front, census } = reflection
  recordGroupInputs(reflection, stages, inputs)
  if (!trace.identity.moved() && trace.groups) return trace.groups
  // What a ray reads of the scene, the scene stage's.
  const scene: Named = {
    lights: { buffer: inputs.lights },
    blue: inputs.blue,
    ...(census.buffer && { census: { buffer: census.buffer } }),
  }
  const sceneEntries = [
    ...surfaceHitEntries(REFLECTION_HIT_BINDINGS, inputs.field, inputs.hit),
    ...rayFogBindEntries(REFLECTION_FOG_BINDINGS, true, inputs.fog),
  ]
  return (trace.groups = {
    // The kernel that keeps this image's depth for the next image's hits (`../past.ts`).
    keepDepth: device.createBindGroup({
      layout: layouts.keepDepth,
      entries: [{ binding: REFLECTION_TRACE_BINDINGS.depthKeep, resource: depthView }],
    }),
    opaque: surfaceGroups(
      device,
      layouts,
      scene,
      sceneEntries,
      inputs,
      grids,
      resolvedView,
      inputs.vectors,
      depthView,
      {
        bilateral: layouts.bilateral,
        clear: layouts.clear,
        out: { target: targetView },
      },
    ),
    front: surfaceGroups(
      device,
      layouts,
      scene,
      sceneEntries,
      front.views,
      front.grids,
      resolvedView,
      inputs.vectors,
      depthView,
      {
        bilateral: layouts.bilateralFront,
        clear: layouts.clearFront,
        out: { frontTarget: front.views.traced },
      },
    ),
  })
}
