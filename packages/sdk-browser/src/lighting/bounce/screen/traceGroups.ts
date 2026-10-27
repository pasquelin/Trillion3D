import { DAG_BINDING, dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitCardsEntries, surfaceHitEntries } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { COMPOSITE_BINDINGS, CONVERT_BINDINGS } from './gatherWgsl.ts'
import { FIXUP_BINDINGS, MIP_BINDINGS } from './gatherMipsWgsl.ts'
import { buffers, groupOf, type GroupParts } from './groupParts.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import { INTEGRATE_BINDINGS, TILE_BINDINGS } from './integratePassWgsl.ts'
import { OCCLUSION_BINDINGS } from './occlusionWgsl.ts'
import { PROBE_FILTER_BINDINGS } from './probeFilterWgsl.ts'
import { SPATIAL_BINDINGS } from './spatialWgsl.ts'
import { STOCHASTIC_BINDINGS } from './stochasticWgsl.ts'
import { TEMPORAL_BINDINGS } from './temporalWgsl.ts'
import { rayFogBindEntries } from '../../reflections/rayFog.ts'
import {
  TRACE_SCENE_BINDINGS,
  TRACE_SCENE_FOG,
  TRACE_SCENE_HIT,
  TRACE_SCENE_PROBES,
} from './traceSceneWgsl.ts'
import {
  TRACE_TRACED_BINDINGS,
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
} from './traceTracedWgsl.ts'
import { TRACE_SCREEN_BINDINGS, TRACE_SCREEN_PROBES } from './traceWgsl.ts'

/** The groups of the scene stage that casts its rays through the scene's triangles (`traceTracedWgsl.ts`): its own over a view's resources and
 *  the cut's tables, the scene trace's over the scene trace of the image — each made again only where a resource it names moved. */
export interface TracedSceneGroups {
  readonly pipeline: GPUComputePipeline
  readonly groups: readonly [GPUBindGroup, GPUBindGroup]
}

/** The binder of those groups: `(layouts, rays, previous)` the groups over the traced kernel's layouts, the scene trace `rays` of the image and the poses the last image drew (`previous`). */
function tracedSceneBinder(g: GroupParts) {
  const { device, r, inputs, features, common, probe } = g
  const identity = createWebgpuBindIdentity()
  const sceneGroup = sceneTraceGroupBinder(device)
  let group: GPUBindGroup | undefined
  return (layouts: readonly GPUBindGroupLayout[], rays: SceneRays, previous: GPUTextureView) => {
    const { views } = rays
    identity.next[0] = views.nodes
    identity.next[1] = views.frames
    identity.next[2] = views.worlds
    identity.next[3] = views.tree
    identity.next[4] = previous
    if (identity.moved())
      group = device.createBindGroup({
        layout: layouts[0],
        entries: [
          ...namedEntries(TRACE_TRACED_BINDINGS.at, {
            ...common,
            ...probe,
            ray: r.ray,
            radiance: r.radiance,
            hit: r.hit,
            blue: inputs.blue,
            ...buffers({
              bounceGrid: inputs.bounceGrid,
              pixels: r.pixels,
              sceneRays: r.sceneRays,
            }),
          }),
          ...dagReadGroupEntries(views),
          { binding: DAG_BINDING.previous, resource: previous },
          ...surfaceHitCardsEntries(TRACE_TRACED_HIT, inputs.hit),
          ...(features.heightFog
            ? [{ binding: TRACE_TRACED_FOG.lights, resource: { buffer: inputs.lights } }]
            : []),
          ...rayFogBindEntries(TRACE_TRACED_FOG, features.heightFog, inputs.fog),
        ],
      })
    const scene = sceneGroup(
      layouts[TRACE_TRACED_SCENE.group],
      rays.sceneTrace,
      TRACE_TRACED_SCENE.first,
    )
    return [group!, scene] as const
  }
}

/** The trace of the rays: the screen's stage and the scene's, which marches the rays through the global distance field, reads the surface cache at
 *  their hits and the radiance cache for the rays it leaves, or, where the image casts them through the scene's triangles, the binder of that
 *  stage's groups (`tracedScene`; the radiance cache's answer is `traceScene`'s second entry). */
export function traceGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, features, last, common, probe, records } = g
  const field = { bounceGrid: inputs.bounceGrid }
  const trace = { ray: r.ray, radiance: r.radiance, hit: r.hit }
  return {
    tracedScene: tracedSceneBinder(g),
    traceScreen: groupOf(device, kernels.traceScreen, [
      ...namedEntries(TRACE_SCREEN_BINDINGS.at, {
        ...common,
        ...records,
        ...trace,
        ...buffers({ ...field, sceneRays: r.sceneRays }),
        keptDepth: r.keptDepth[last],
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
        }),
      }),
      { binding: TRACE_SCENE_PROBES, resource: inputs.probes },
      ...surfaceHitEntries(TRACE_SCENE_HIT, inputs.field, inputs.hit),
      ...rayFogBindEntries(TRACE_SCENE_FOG, features.heightFog, inputs.fog),
    ]),
  }
}

/** The filter: the composite into the octahedron (and, with the temporal filter of the probes, into the history texture of this turn, which the filter reads
 *  beside the last turn's), the spatial passes, the conversion to what the pixels read, the border and the coarser level of the filtered radiance. */
export function filterGroups(g: GroupParts, kernels: CastKernels) {
  const { device, r, inputs, features, last, turn, final, ranks, common, probe, records } = g
  const { extraAo } = features
  const { mips } = r
  const composited = features.filterProbes ? r.probeHistory[turn] : r.gather[0]
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
        gather: composited,
        blue: inputs.blue,
        ...(extraAo && { ao: r.extraAo[0] }),
        ...buffers({ moving: r.moving }),
      }),
    ),
    probeFilter:
      kernels.probeFilter &&
      groupOf(
        device,
        kernels.probeFilter,
        namedEntries(PROBE_FILTER_BINDINGS.at, {
          ...common,
          ...records,
          historyInfo: r.info[last],
          history: r.probeHistory[last],
          composite: r.probeHistory[turn],
          filtered: r.gather[0],
          vectors: inputs.vectors,
        }),
      ),
    spatial: ranks.map((rank, pass) =>
      groupOf(
        device,
        kernels.spatial,
        namedEntries(SPATIAL_BINDINGS.at, {
          ...common,
          ...records,
          ...buffers({ disocclusion: r.disocclusion, moving: r.moving, pass: rank }),
          gatherIn: r.gather[pass % 2],
          gatherOut: r.gather[1 - (pass % 2)],
          blue: inputs.blue,
          ...(extraAo && { aoIn: r.extraAo[pass % 2], aoOut: r.extraAo[1 - (pass % 2)] }),
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
        ...(extraAo && { ao: r.extraAo[final] }),
      }),
    ),
    fixup: groupOf(
      device,
      kernels.fixup,
      namedEntries(FIXUP_BINDINGS.at, {
        ...common,
        ...probe,
        ...buffers({ counts: r.counts }),
        gather: r.gather[final],
        level: mips.levels[0],
      }),
    ),
    mips: kernels.mips.map((kernel, at) =>
      groupOf(
        device,
        kernel,
        namedEntries(MIP_BINDINGS.at, {
          ...common,
          parent: mips.levels[at],
          child: mips.levels[at + 1],
        }),
      ),
    ),
  }
}

/** The pixels: the short-range occlusion, the integration of the probes where the level casts them (the classification of the tiles it is dispatched
 *  over, the texel each pixel reads where it is downsampled, the integration) and the temporal pass, which blends what the integration left. */
export function pixelGroups(g: GroupParts, kernels: ScreenProbeKernels) {
  const { device, r, inputs, features, last, turn, common, probe, surface } = g
  const { cast } = kernels
  const integration = cast?.integrate ?? cast?.integrateEvery
  const integrated = { light: r.light, rough: r.rough, back: r.back }
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
    tile:
      cast?.tile &&
      groupOf(
        device,
        cast.tile,
        namedEntries(TILE_BINDINGS.at, {
          ...common,
          ...surface,
          ...integrated,
          ...buffers({ tiles: r.tileList, args: r.tileArgs }),
        }),
      ),
    stochastic:
      cast?.stochastic &&
      groupOf(
        device,
        cast.stochastic,
        namedEntries(STOCHASTIC_BINDINGS.at, {
          ...common,
          ...surface,
          offsets: r.offsets,
          blue: inputs.blue,
        }),
      ),
    integrate:
      integration &&
      groupOf(
        device,
        integration,
        namedEntries(INTEGRATE_BINDINGS.at, {
          ...common,
          ...surface,
          ...probe,
          ...integrated,
          occlusion: r.occlusion,
          irradiance: r.irradiance,
          gather: r.mips.all,
          blue: inputs.blue,
          lobes: inputs.lobes,
          base: inputs.base,
          emissiveAo: inputs.emissiveAo,
          ...buffers({
            pixels: r.pixels,
            header: r.header,
            indices: r.indices,
            moving: r.moving,
            counts: r.counts,
          }),
          ...(cast?.tile && buffers({ tiles: r.tileList, args: r.tileArgs })),
        }),
      ),
    temporal: groupOf(
      device,
      kernels.temporal,
      namedEntries(TEMPORAL_BINDINGS.at, {
        ...common,
        ...surface,
        ...(cast && integrated),
        ...(cast && features.integrate > 1 && { offsets: r.offsets }),
        occlusion: r.occlusion,
        history: r.history[last],
        historyOut: r.history[turn],
        shading: r.shading[last],
        shadingOut: r.shading[turn],
        keptDepth: r.keptDepth[last],
        keptDepthOut: r.keptDepth[turn],
        vectors: inputs.vectors,
        blue: inputs.blue,
      }),
    ),
  }
}
