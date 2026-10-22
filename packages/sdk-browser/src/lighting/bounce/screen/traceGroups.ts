import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { sceneBindEntries } from '../sceneBindings.ts'
import { COMPOSITE_BINDINGS, CONVERT_BINDINGS } from './gatherWgsl.ts'
import { buffers, groupOf, type GroupParts } from './groupParts.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import { OCCLUSION_BINDINGS } from './occlusionWgsl.ts'
import { SPATIAL_BINDINGS } from './spatialWgsl.ts'
import { TEMPORAL_BINDINGS } from './temporalWgsl.ts'
import { TRACE_FIELD_BINDINGS, TRACE_FIELD_PROBES } from './traceFieldWgsl.ts'
import {
  SCREEN_PROXY_BINDINGS,
  TRACE_SCENE_BINDINGS,
  TRACE_SCENE_LIGHT_FUNCTION,
  TRACE_SCENE_PROBES,
} from './traceSceneWgsl.ts'
import { TRACE_SCREEN_BINDINGS, TRACE_SCREEN_PROBES } from './traceWgsl.ts'

/** The trace of the rays: the screen's stage, the field's and the scene's where it is asked. */
export function traceGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, last, common, records } = g
  const field = { bounceGrid: inputs.bounceGrid }
  const trace = { ray: r.ray, radiance: r.radiance, hit: r.hit }
  return {
    traceScreen: groupOf(device, kernels.traceScreen, [
      ...namedEntries(TRACE_SCREEN_BINDINGS.at, {
        ...common,
        ...records,
        ...trace,
        ...buffers({ ...field, sceneRays: r.sceneRays }),
        history: r.history[last],
        vectors: inputs.vectors,
        flags: inputs.flags,
        blue: inputs.blue,
      }),
      { binding: TRACE_SCREEN_PROBES, resource: inputs.probes },
    ]),
    traceField: groupOf(device, kernels.traceField, [
      ...namedEntries(TRACE_FIELD_BINDINGS.at, {
        ...common,
        ...records,
        ...trace,
        blue: inputs.blue,
        cacheFinal: inputs.cacheFinal,
        cacheRaw: inputs.cacheRaw,
        ...buffers({ ...field, lights: inputs.lights, cacheTags: inputs.cacheTags }),
      }),
      { binding: TRACE_FIELD_PROBES, resource: inputs.probes },
    ]),
    traceScene: kernels.traceScene
      ? groupOf(device, kernels.traceScene, [
          ...namedEntries(TRACE_SCENE_BINDINGS.at, {
            ...common,
            ...records,
            ...trace,
            blue: inputs.blue,
            ...buffers({
              ...field,
              lights: inputs.lights,
              lightLists: inputs.lightLists,
              sceneRays: r.sceneRays,
            }),
          }),
          { binding: TRACE_SCENE_PROBES, resource: inputs.probes },
          ...sceneBindEntries(SCREEN_PROXY_BINDINGS, inputs.proxy),
          { binding: TRACE_SCENE_LIGHT_FUNCTION.atlas, resource: inputs.lightFunction },
        ])
      : undefined,
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
  const { device, r, inputs, last, turn, common, probe, surface } = g
  const probes = kernels.cast && {
    ...probe,
    irradiance: r.irradiance,
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
        vectors: inputs.vectors,
        blue: inputs.blue,
        ...probes,
      }),
    ),
  }
}
