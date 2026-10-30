import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { litListGroups } from '../../reflections/hitLighting/kernels.ts'
import {
  admitLitListResources,
  litMostRays,
  litRunBinder,
  type LitListGroups,
  type LitListResources,
  type LitListRun,
} from '../../reflections/hitLighting/listPasses.ts'
import { lightProfileBindEntries } from '../../lightProfile/profileBindings.ts'
import type { CacheHitLighting } from '../cache/cacheHitLit.ts'
import { rayFogBindEntries } from '../../reflections/rayFog.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { hitLightingProbesRun } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { isPending, isReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { buffers, type GroupParts } from './groupParts.ts'
import {
  PROBE_LIT_COMPACT,
  PROBE_LIT_DIRECT,
  PROBE_LIT_FINISH,
  PROBE_LIT_HIT,
  PROBE_LIT_HOST,
} from './hitLitWgsl.ts'
import { kernelShapeOf } from './kernels.ts'
import type { ScreenProbeView } from './view.ts'
import {
  probeLitCompactLayout,
  probeLitDirectLayout,
  probeLitFinishKey,
  probeLitFinishLayout,
  probeLitKey,
  probeLitMaker,
  probeLitSceneLayout,
  type ProbeLitKernels,
} from './hitLitKernels.ts'
import { TRACE_TRACED_FOG, TRACE_TRACED_SCENE } from './traceTracedWgsl.ts'

/** Whether the buffers for `rays` rays fit one storage binding of the device. */
export const probeLitFits = (device: GPUDevice, rays: number) => rays <= litMostRays(device)

/**
 * The binder of the screen probes' hit lighting over a view's `GroupParts`: `(kernels, rays, resources, hit, bucket)` the run of the image, whose groups over the kernels' layouts, the scene trace of the image and the lists are made again
 * only where a resource they name moved. The run is one object the binder keeps, written over each image.
 */
export function hitLitBinder(g: GroupParts) {
  const { device, r, inputs, features, common, probe } = g
  const identity = createWebgpuBindIdentity()
  const sceneGroup = sceneTraceGroupBinder(device)
  const runOf = litRunBinder<ProbeLitKernels>(TRACE_TRACED_SCENE.group)
  let groups: LitListGroups | undefined
  return (
    kernels: ProbeLitKernels,
    rays: SceneRays,
    lit: LitListResources,
    hit: CacheHitLighting,
  ) => {
    const { views } = rays
    const { next } = identity
    next.length = 0
    next.push(kernels, lit.list, lit.sorted, lit.args, lit.radiance, r.params)
    next.push(probe.info, probe.normal, r.ray, r.radiance, r.hit, r.pixels, r.sceneRays)
    next.push(inputs.blue, inputs.lights, inputs.fog.cubemap, inputs.fog.sampler)
    next.push(hit.lightFunction as object, hit.lightProfile.view, hit.lightProfile.sampler)
    next.push(hit.lightGridView)
    next.push(views.nodes, views.frames, views.worlds, views.tree)
    next.push(inputs.hit.tables, inputs.hit.depth, inputs.hit.indirect, inputs.hit.instances)
    const scene = sceneGroup(probeLitSceneLayout(device), rays.sceneTrace, TRACE_TRACED_SCENE.first)
    if (identity.moved() || !groups) {
      const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
        device.createBindGroup({ layout, entries })
      const L = PROBE_LIT_COMPACT.at
      const D = PROBE_LIT_DIRECT.at
      const F = PROBE_LIT_FINISH.at
      const lists = {
        litList: lit.list,
        litSorted: lit.sorted,
        litRadiance: lit.radiance,
      }
      const records = { ...common, ...probe }
      groups = {
        scene,
        compact: group(probeLitCompactLayout(device), [
          ...namedEntries(L, {
            ...records,
            radiance: r.radiance,
            hit: r.hit,
            ...buffers({ sceneRays: r.sceneRays, litList: lit.list }),
          }),
        ]),
        ...litListGroups(device, lit, r.radiance),
        direct: group(probeLitDirectLayout(device), [
          ...namedEntries(D, {
            ...records,
            ray: r.ray,
            blue: inputs.blue,
            ...buffers({ pixels: r.pixels, lights: inputs.lights, ...lists }),
          }),
          ...dagReadGroupEntries(views),
          { binding: PROBE_LIT_HOST.lightFunction.atlas, resource: hit.lightFunction },
          ...lightProfileBindEntries(PROBE_LIT_HOST.lightProfile, hit.lightProfile),
          { binding: PROBE_LIT_HOST.lightGrid, resource: hit.lightGridView },
        ]),
        finish: group(
          probeLitFinishLayout(
            device,
            probeLitFinishKey({ heightFog: features.heightFog, light: features.light }),
          ),
          [
            ...namedEntries(F, {
              ...records,
              ray: r.ray,
              radiance: r.radiance,
              blue: inputs.blue,
              ...buffers({ pixels: r.pixels, ...lists }),
            }),
            ...surfaceHitCardsEntries(PROBE_LIT_HIT, inputs.hit),
            ...(features.heightFog
              ? [{ binding: TRACE_TRACED_FOG.lights, resource: { buffer: inputs.lights } }]
              : []),
            ...rayFogBindEntries(TRACE_TRACED_FOG, features.heightFog, inputs.fog),
          ],
        ),
      }
    } else groups.scene = scene
    const run = runOf(kernels, lit, groups, hit.settings.bucket)
    run.grid = hit.lightGrid
    return run
  }
}

/** The head of the list of the hits to light, emptied for an image (the count is its first word), on the commands of `encoder`. */
export function resetProbeHitLighting(encoder: GPUCommandEncoder, run: LitListRun) {
  encoder.clearBuffer(run.resources.list, 0, 4)
}

/** Gives back the hit lighting a view kept, where its option is off, refused or the rays are no longer cast through the triangles. */
export function releaseProbeHitLit(state: Pick<ScreenProbeView, 'hitLit'>) {
  state.hitLit?.dispose()
  state.hitLit = undefined
}

/** What the refusals said, by device: said again only when the rays' count changes. */
const refused = new WeakMap<GPUDevice, number>()

/** The key of the kernels each settings object last asked for, with the format it was made for: the shape of the kernels is worked out when the settings or the format change, not each image. */
const keys = new WeakMap<ScreenProbeSettings, { light: unknown; key: string }>()
const litKeyOf = (settings: ScreenProbeSettings, light: Parameters<typeof kernelShapeOf>[1]) => {
  const held = keys.get(settings)
  if (held && held.light === light) return held.key
  const key = probeLitKey(kernelShapeOf(settings, light))
  keys.set(settings, { light, key })
  return key
}

/** The label of the view's lists in the device's ledger. */
const LIT_LABEL = 'Trillion3D screen probe hit lighting'

/**
 * THE HIT LIGHTING OF THIS IMAGE'S PROBES where it runs: the settings light the hits (`hit`, none where they do not: `bounceHitLightingOf`), the scene has acceleration structures (`rays`), the buffers fit one storage binding of the device (else the option is refused with
 * a line in the console and the hits are lit from the cards), the device's budget leaves room for them (`admitLitListResources`, else the same) and the kernels over the held set of graph masks are compiled (the stage that marks the hits among them, so that it and the passes
 * run on one set). The view keeps its resources (`ScreenProbeView.hitLit`), made again where the rays of the view moved, and gives them back whenever the hit lighting does not run this image except while the kernels compile, which the mode being on and the resources
 * being the next image's the same ones makes worth the wait. The run's `kernels.traced` is the stage that marks the hits, ready for the image's groups.
 */
export function probeHitLitOf(
  device: GPUDevice,
  state: Pick<ScreenProbeView, 'resources' | 'hitLit'>,
  settings: ScreenProbeSettings,
  hit: CacheHitLighting | undefined,
  rays: SceneRays,
  light: Parameters<typeof kernelShapeOf>[1],
  bind: ReturnType<typeof hitLitBinder>,
): LitListRun<ProbeLitKernels> | undefined {
  if (!hit || !hitLightingProbesRun(hit.settings)) {
    releaseProbeHitLit(state)
    return undefined
  }
  const g = state.resources.geometry
  const capacity = (g.uniform + g.maxAdaptive) * g.tracing * g.tracing
  if (!probeLitFits(device, capacity)) {
    releaseProbeHitLit(state)
    if (refused.get(device) !== capacity) {
      refused.set(device, capacity)
      console.warn(
        `screen probe hit lighting refused: ${capacity} rays need more than the storage binding of this device holds (min of maxStorageBufferBindingSize and maxBufferSize); the hits are lit from the surface cache`,
      )
    }
    return undefined
  }
  const key = litKeyOf(settings, light)
  const kernels = rays.sceneTrace.maskHold.use(
    'screen hit lighting',
    key,
    probeLitMaker(device, key),
    isReady,
    isPending,
  )?.kernel
  if (!kernels?.ready) return undefined
  // The budget refusing the lists leaves the hits lit from the cards (the held lists are given back either way).
  const resources = (state.hitLit = admitLitListResources(
    device,
    state.hitLit,
    LIT_LABEL,
    capacity,
  ))
  return resources && bind(kernels, rays, resources, hit)
}
