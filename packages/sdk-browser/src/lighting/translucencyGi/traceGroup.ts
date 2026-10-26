import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { TRACE_SCENE_HIT } from '../bounce/screen/traceSceneWgsl.ts'
import { surfaceHitEntries, type SurfaceHitReads } from '../surfaceCache/hitWgsl.ts'
import type { TranslucencyGiState } from './gpu.ts'
import type { TranslucencyGiKernels } from './kernels.ts'
import { TRACE_GI_BINDINGS, TRACE_GI_LIGHT, TRACE_GI_PROBES } from './traceWgsl.ts'

/** What the trace reads beyond the volume's own: the screen probes' parameters, the cascades' uniform and atlas, the lights, the blue noise, the
 *  radiance cache's maps and the distance field and surface cache the rays are marched through. */
export interface GiTraceInputs {
  params: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  lights: GPUBuffer
  blue: GPUTextureView
  cacheFinal: GPUTextureView
  cacheRaw: GPUTextureView
  cacheSky: GPUTextureView
  cacheTags: GPUBuffer
  reads: SurfaceHitReads
}

/** The trace's group: made again only when what it names moved. */
export function traceGroupOf(
  device: GPUDevice,
  state: TranslucencyGiState,
  kernels: TranslucencyGiKernels,
  i: GiTraceInputs,
) {
  const { next } = state.trace
  next.length = 0
  next.push(
    state.resources!.frame,
    state.resources!.cones[0],
    kernels.trace.layout,
    i.params,
    i.bounceGrid,
    i.probes,
    i.lights,
    i.blue,
    i.cacheFinal,
    i.cacheRaw,
    i.cacheSky,
    i.cacheTags,
    i.reads.field,
    // The hit's resources, one by one: the object holding them is written in place each image (`hitCards.ts`).
    i.reads.hit.tables,
    i.reads.hit.depth,
    i.reads.hit.final,
    i.reads.hit.feedback,
    i.reads.hit.grid,
    i.reads.hit.instances,
  )
  // Asked every time: the identity takes what it saw, so that a group made again after the resources were replaced is not made twice.
  const moved = state.trace.moved()
  if (state.traceGroup && !moved) return state.traceGroup
  const { frame, cones } = state.resources!
  return (state.traceGroup = device.createBindGroup({
    label: 'Trillion3D translucency GI trace',
    layout: kernels.trace.layout,
    entries: [
      ...namedEntries(TRACE_GI_BINDINGS.at, {
        params: { buffer: i.params },
        frame: { buffer: frame },
        bounceGrid: { buffer: i.bounceGrid },
        lights: { buffer: i.lights },
        blue: i.blue,
        cacheFinal: i.cacheFinal,
        cacheRaw: i.cacheRaw,
        cacheSky: i.cacheSky,
        cacheTags: { buffer: i.cacheTags },
      }),
      { binding: TRACE_GI_LIGHT, resource: cones[0] },
      { binding: TRACE_GI_PROBES, resource: i.probes },
      ...surfaceHitEntries(TRACE_SCENE_HIT, i.reads.field, i.reads.hit),
    ],
  }))
}
