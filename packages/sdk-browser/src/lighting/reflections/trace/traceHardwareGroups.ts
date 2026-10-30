import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { reflectionHitWords, type ReflectionGrids } from '../grids.ts'
import { rayFogBindEntries } from '../rayFog.ts'
import {
  hardwareHitLayout,
  hardwareMaskedTraceLayout,
  hardwareSceneLayout,
  hardwareTraceLayout,
  REFLECTION_FOG_BINDINGS,
  REFLECTION_HARDWARE_SCENE,
  REFLECTION_HIT_BINDINGS,
  REFLECTION_TRACE_BINDINGS,
} from './traceBindings.ts'
import type { TraceInputs, TraceResources } from './traceGroups.ts'

/** The groups of the scene stage that casts its rays through the scene's triangles (`../sceneTraceHardware.ts`): for the answer and for the trace of the rays, one for each surface and the
 *  scene trace's, with what they were made over. */
type HardwareGroups = {
  opaque: GPUBindGroup
  front: GPUBindGroup
  scene: GPUBindGroup
  /** The trace's group 0 for each surface, and its scene trace group with the any-hit test. */
  hits: { opaque: GPUBindGroup; front: GPUBindGroup }
  maskedScene: GPUBindGroup
}

/** The textures of a surface's pixels both groups of a surface bind. */
type SurfacePixels = { flags: GPUTextureView; normals: GPUTextureView; lobes: GPUTextureView }

/** A view's hardware scene groups, none made yet. */
export const createHardwareTraceGroups = (device: GPUDevice) => ({
  identity: createWebgpuBindIdentity(),
  sceneGroup: sceneTraceGroupBinder(device, false),
  maskedSceneGroup: sceneTraceGroupBinder(device),
  groups: undefined as HardwareGroups | undefined,
})

/**
 * The groups of the scene stage over the image's scene trace `rays` (`SceneRays`): group 0 of each surface, the scene stage's own
 * (`hardwareSceneLayout`) — the surface's pixels, its rays, the lights, the fog's cubemap, the surfaces' vectors and the last image's depth, the fresh grid, the
 * rays missed and what a hit reads of the surface cache —, and the scene trace's
 * (`hardwareTraceLayout`): the surfaces' made again only when a resource they name is not the one they were made over, the scene trace's
 * by its own binder (`sceneTraceGroupBinder`), which keeps it while its layout and buffers stay. `hits`: whether the stage keeps the key of a hit's
 * material (`lit`) and the grid the image uses, which size the hits' buffers.
 */
export function hardwareTraceGroups(
  reflection: TraceResources,
  inputs: TraceInputs,
  rays: SceneRays,
  light: LightAtlasFormat,
  hits: { lit: boolean; grid: readonly [number, number] },
): HardwareGroups {
  const words = reflectionHitWords(hits.lit)
  const { device, grids, front, trace } = reflection
  const layout = hardwareSceneLayout(device, light)
  const { identity } = trace.hardware
  const { sceneTrace, views } = rays
  const { hit } = inputs
  const { next } = identity
  next.length = 0
  next.push(layout, grids, front.grids, front.views.flags, front.views.normals, front.views.lobes)
  next.push(inputs.flags, inputs.normals, inputs.lobes, inputs.lights)
  next.push(inputs.fog.cubemap, inputs.fog.sampler)
  next.push(inputs.vectors, reflection.depthView)
  next.push(hit.tables, hit.depth, hit.final, hit.feedback, hit.instances)
  next.push(grids.hits(words, hits.grid), front.grids.hits(words, hits.grid))
  // The cut's tables the trace of the rays binds (`dagReadGroupEntries`).
  next.push(views.nodes, views.frames, views.worlds, views.tree)
  const scene = trace.hardware.sceneGroup(
    hardwareTraceLayout(device),
    sceneTrace,
    REFLECTION_HARDWARE_SCENE.first,
  )
  const maskedScene = trace.hardware.maskedSceneGroup(
    hardwareMaskedTraceLayout(device),
    sceneTrace,
    REFLECTION_HARDWARE_SCENE.first,
  )
  const held = trace.hardware.groups
  if (!identity.moved() && held) {
    held.scene = scene
    held.maskedScene = maskedScene
    return held
  }
  const surface = (pixels: SurfacePixels, own: ReflectionGrids) =>
    device.createBindGroup({
      layout,
      entries: [
        ...namedEntries(REFLECTION_TRACE_BINDINGS, {
          flags: pixels.flags,
          normals: pixels.normals,
          lobes: pixels.lobes,
          rays: own.rays,
          lights: { buffer: inputs.lights },
          vectors: inputs.vectors,
          depthHistory: reflection.depthView,
          traceOut: own.fresh,
          pendingIn: { buffer: own.pending },
        }),
        ...surfaceHitCardsEntries(REFLECTION_HIT_BINDINGS, hit),
        ...rayFogBindEntries(REFLECTION_FOG_BINDINGS, true, inputs.fog),
        {
          binding: REFLECTION_TRACE_BINDINGS.hits,
          resource: { buffer: own.hits(words, hits.grid) },
        },
      ],
    })
  // The trace of the rays: the surface's pixels and rays, the lights, the cut's tables, the rays missed and the hits' buffer.
  const hitsOf = (pixels: SurfacePixels, own: ReflectionGrids) =>
    device.createBindGroup({
      layout: hardwareHitLayout(device),
      entries: [
        ...namedEntries(REFLECTION_TRACE_BINDINGS, {
          flags: pixels.flags,
          normals: pixels.normals,
          lobes: pixels.lobes,
          rays: own.rays,
          lights: { buffer: inputs.lights },
          pendingIn: { buffer: own.pending },
          hits: { buffer: own.hits(words, hits.grid) },
        }),
        ...dagReadGroupEntries(views),
      ],
    })
  return (trace.hardware.groups = {
    opaque: surface(inputs, grids),
    front: surface(front.views, front.grids),
    scene,
    hits: { opaque: hitsOf(inputs, grids), front: hitsOf(front.views, front.grids) },
    maskedScene,
  })
}
