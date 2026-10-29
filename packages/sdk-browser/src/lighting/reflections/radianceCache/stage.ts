import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { ReflectionSettings } from '../../../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { TraceInputs, TraceResources } from '../trace/traceGroups.ts'
import { rayFogBindEntries } from '../rayFog.ts'
import { REFLECTION_FOG_BINDINGS, REFLECTION_TRACE_BINDINGS } from '../trace/traceBindings.ts'
import { radianceCacheKernels } from './kernels.ts'
import { RADIANCE_CACHE_BINDINGS, RADIANCE_CACHE_PROBES } from './wgsl.ts'

/** The two dispatches of the radiance cache in the trace's passes (`encodeReflectionTrace`): `limits` before the screen stage, `reads` after the scene stage,
 *  each over the opaque surface's tracing tiles. */
export interface RadianceCacheStage {
  limits(pass: GPUComputePassEncoder, tiles: GPUBuffer): void
  reads(pass: GPUComputePassEncoder, tiles: GPUBuffer): void
}

/** A view's group and the identity of what it names, by the view's trace groups. */
const bound = new WeakMap<
  object,
  { ids: ReturnType<typeof createWebgpuBindIdentity>; group?: GPUBindGroup }
>()

/**
 * THE REFLECTIONS' RADIANCE CACHE of this image (`reflectionRadianceCache`, `radianceCache/wgsl.ts`): its two kernels over the world's cache, none while the
 * setting is off, the view is not the main one's, the screen probes made no cache this image or the program is still compiling — the rays then go their
 * whole length.
 */
export function radianceCacheStage(
  rt: WebgpuPagesRuntime,
  reflection: TraceResources,
  inputs: TraceInputs,
  settings: ReflectionSettings,
): RadianceCacheStage | undefined {
  if (!settings.radianceCache || !settings.enabled) return undefined
  const probes = rt.bounce.probes
  const cache = probes?.cache.views
  const screen = rt.gpu.screenProbes
  const params = screen?.indirect && screen.resources.params
  if (!probes || !cache || !params) return undefined
  const kernels = radianceCacheKernels(reflection.device, cache.light)
  if (!kernels.ready) return undefined
  const { grids, device } = reflection
  const who = reflection.trace
  let held = bound.get(who)
  if (!held) bound.set(who, (held = { ids: createWebgpuBindIdentity() }))
  const { ids } = held
  const { next } = ids
  next.length = 0
  next.push(
    kernels.layout,
    grids,
    inputs.flags,
    inputs.normals,
    inputs.lobes,
    inputs.lights,
    inputs.blue,
  )
  next.push(inputs.fog.cubemap, inputs.fog.sampler, params, probes.uniform, probes.table)
  next.push(cache.final, cache.raw, cache.sky)
  const moved = ids.moved()
  if (!held.group || moved) {
    const C = RADIANCE_CACHE_BINDINGS.at
    held.group = device.createBindGroup({
      label: 'Trillion3D reflection radiance cache',
      layout: kernels.layout,
      entries: [
        ...namedEntries(REFLECTION_TRACE_BINDINGS, {
          flags: inputs.flags,
          normals: inputs.normals,
          lobes: inputs.lobes,
          rays: grids.rays,
          tiles: { buffer: grids.tracing },
          lights: { buffer: inputs.lights },
          blue: inputs.blue,
          traceOut: grids.fresh,
        }),
        ...rayFogBindEntries(REFLECTION_FOG_BINDINGS, true, inputs.fog),
        ...namedEntries(C, {
          params: { buffer: params },
          bounceGrid: { buffer: probes.uniform },
          cacheFinal: cache.final,
          cacheRaw: cache.raw,
          cacheSky: cache.sky,
        }),
        { binding: RADIANCE_CACHE_PROBES, resource: probes.table },
      ],
    })
  }
  const group = held.group
  const dispatch =
    (entry: 'cacheLimits' | 'cacheReads') => (pass: GPUComputePassEncoder, tiles: GPUBuffer) => {
      pass.setPipeline(kernels.pipeline(entry))
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroupsIndirect(tiles, 0)
    }
  return { limits: dispatch('cacheLimits'), reads: dispatch('cacheReads') }
}
