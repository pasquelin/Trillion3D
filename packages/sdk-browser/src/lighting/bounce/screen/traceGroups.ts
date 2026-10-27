import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { surfaceHitEntries } from '../../surfaceCache/hitWgsl.ts'
import { COMPOSITE_BINDINGS, CONVERT_BINDINGS } from './gatherWgsl.ts'
import { buffers, groupOf, type GroupParts } from './groupParts.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import { OCCLUSION_BINDINGS } from './occlusionWgsl.ts'
import { SPATIAL_BINDINGS } from './spatialWgsl.ts'
import { TEMPORAL_BINDINGS } from './temporalWgsl.ts'
import { TRACE_SCENE_BINDINGS, TRACE_SCENE_HIT, TRACE_SCENE_PROBES } from './traceSceneWgsl.ts'
import { TRACE_SCREEN_BINDINGS, TRACE_SCREEN_PROBES } from './traceWgsl.ts'

/** The trace of the rays: the screen's stage and the scene's, which marches the rays through the global distance field, reads the surface cache at
 *  their hits and the radiance cache for the rays it leaves. */
export function traceGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, last, common, probe, records } = g
  const field = { bounceGrid: inputs.bounceGrid }
  const trace = { ray: r.ray, radiance: r.radiance, hit: r.hit }
  return {
    traceScreen: groupOf(device, kernels.traceScreen, [
      ...namedEntries(TRACE_SCREEN_BINDINGS.at, {
        ...common,
        ...records,
        ...trace,
        ...buffers({ ...field, sceneRays: r.sceneRays }),
        depth: r.depth[last],
        vectors: inputs.vectors,
        flags: inputs.flags,
        blue: inputs.blue,
      }),
      { binding: TRACE_SCREEN_PROBES, resource: inputs.probes },
    ]),
    traceScene: groupOf(device, kernels.traceScene, [
      ...namedEntries(TRACE_SCENE_BINDINGS.at, {
        ...common,
        ...probe,
        ...trace,
        blue: inputs.blue,
        cacheFinal: inputs.cacheFinal,
        cacheRaw: inputs.cacheRaw,
        cacheSky: inputs.cacheSky,
        ...buffers({
          ...field,
          pixels: r.pixels,
          lights: inputs.lights,
          sceneRays: r.sceneRays,
          cacheTags: inputs.cacheTags,
        }),
      }),
      { binding: TRACE_SCENE_PROBES, resource: inputs.probes },
      ...surfaceHitEntries(TRACE_SCENE_HIT, inputs.field, inputs.hit),
    ]),
  }
}

/** The filter: the composite into the octahedron, the spatial passes, the conversion to what the pixels read. */
export function filterGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, final, common, probe, records } = g
  return {
    composite: groupOf(
      device,
      kernels.composite,
      namedEntries(COMPOSITE_BINDINGS.at, {
        ...common,
        ...records,
        ray: r.ray,
        radiance: r.radiance,
        hit: r.hit,
        gather: r.gather[0],
        blue: inputs.blue,
        ...buffers({ moving: r.moving }),
      }),
    ),
    spatial: [0, 1].map((source) =>
      groupOf(
        device,
        kernels.spatial,
        namedEntries(SPATIAL_BINDINGS.at, {
          ...common,
          ...records,
          ...buffers({ disocclusion: r.disocclusion, moving: r.moving }),
          gatherIn: r.gather[source],
          gatherOut: r.gather[1 - source],
          blue: inputs.blue,
        }),
      ),
    ),
    convert: groupOf(
      device,
      kernels.convert,
      namedEntries(CONVERT_BINDINGS.at, {
        ...common,
        ...probe,
        ...buffers({ counts: r.counts }),
        gather: r.gather[final],
        irradiance: r.irradiance,
      }),
    ),
  }
}

/** The pixels: the short-range occlusion and the temporal pass, which integrates the probes where the level casts them. */
export function pixelGroups(g: GroupParts, kernels: ScreenProbeKernels) {
  const { device, r, inputs, last, turn, final, common, probe, surface } = g
  const probes = kernels.cast && {
    ...probe,
    irradiance: r.irradiance,
    gather: r.gather[final],
    ...buffers({
      pixels: r.pixels,
      header: r.header,
      indices: r.indices,
      moving: r.moving,
      counts: r.counts,
    }),
  }
  return {
    occlusion: groupOf(
      device,
      kernels.occlusion,
      namedEntries(OCCLUSION_BINDINGS.at, {
        ...common,
        ...surface,
        occlusion: r.occlusion,
        blue: inputs.blue,
      }),
    ),
    temporal: groupOf(
      device,
      kernels.temporal,
      namedEntries(TEMPORAL_BINDINGS.at, {
        ...common,
        ...surface,
        occlusion: r.occlusion,
        history: r.history[last],
        historyOut: r.history[turn],
        depth: r.depth[last],
        depthOut: r.depth[turn],
        shading: r.shading[last],
        shadingOut: r.shading[turn],
        vectors: inputs.vectors,
        blue: inputs.blue,
        ...probes,
      }),
    ),
  }
}
