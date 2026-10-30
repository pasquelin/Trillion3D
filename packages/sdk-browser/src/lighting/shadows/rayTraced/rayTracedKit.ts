import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { dagReadLayoutEntries, dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { perViewRuns } from '../../../gpu/core/encoderUniforms.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { arrayView } from '../../../gpu/core/textureViews.ts'
import { viewKey } from '../../../frame/backend/state/viewKey.ts'
import { groupFor } from '../../../gpu/bind/cachedGroup.ts'
import { reflectionGroup, reflectionLightView } from '../../reflections/group.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { hardwareTraceLayout } from '../../reflections/trace/traceBindings.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { SelfShadowRect } from '../firstPerson/selfShadowWindow.ts'
import {
  RAY_TRACED_BINDINGS as B,
  RAY_TRACED_ENTRY,
  RAY_TRACED_GROUP,
  RAY_TRACED_SCENE,
  rayTracedProgram,
} from './rayTracedWgsl.ts'

/** Centimetres in a metre: the settings' distances are in centimetres, the scene's in metres. */
const CM = 0.01
/** The least normal bias, in centimetres: a ray's start is moved off its surface by at least this. */
const LEAST_BIAS_CM = 0.01
const LIGHT_AT = 16
const LOD_AT = LIGHT_AT + 4
const PARAM_WORDS = LOD_AT + 4

/** What the kernel is made of on a device: its group 0 layout, the stage (asked once, off the frame), the scene trace's binder. */
const kitOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D ray traced shadow',
    entries: [
      computeUniformEntry(B.params),
      computeTextureEntry(B.normals, 'unfilterable-float'),
      computeTextureEntry(B.flags, 'uint'),
      computeStorageTextureEntry(B.mask, 'r32float', 'read-write', '2d-array'),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeStorageTextureEntry(B.hits, 'r32float', 'write-only', '2d-array'),
      computeTextureEntry(B.subsurface, 'unfilterable-float'),
      ...dagReadLayoutEntries(),
    ],
  })
  const scene = hardwareTraceLayout(device)
  // Bound for the hits where the run has none to write (nothing writes it then).
  const idle = device.createTexture({
    label: 'Trillion3D ray traced shadow idle hits',
    size: [1, 1, 1],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING,
  })
  const words = new ArrayBuffer(PARAM_WORDS * 4)
  return {
    layout,
    idle: arrayView(idle),
    scene,
    sceneGroup: sceneTraceGroupBinder(device),
    words,
    /** The typed views of `words`, every one of whose fields a run writes. */
    ints: new Uint32Array(words),
    floats: new Float32Array(words),
    stage: undefined as ReturnType<typeof askedComputeStage> | undefined,
  }
})

/** The uniforms and the bind groups of the runs of an encode, a pair a view: the groups kept while what they bind is the same, the dependencies the view's, so the views of a device neither overwrite each other's uniforms nor evict each other's groups. */
const runsOf = perViewRuns('Trillion3D ray traced shadow params', PARAM_WORDS * 4)

/** The image each view last ran the kernel in (whatever the caller: local lights, denoised or plain suns), to let its textures and pools go after the keeping delay. */
const tracedAt = new WeakMap<object, number>()

/** The image `gpu`'s view last traced in, if it did. */
export const lastTracedAt = (gpu: { viewKey?: object }) => tracedAt.get(viewKey(gpu))

/** A view's bind groups and uniforms of the runs let go (the view's rays go: `releaseRayTracedLocal`). */
export function releaseRayTracedGroups(gpu: { viewKey?: object }) {
  tracedAt.delete(viewKey(gpu))
  runsOf.release(viewKey(gpu))
}

/**
 * THE RAY TRACED SHADOW KERNEL (`rayTracedWgsl.ts`) run for the light of rank `job.rank`, `job.samples` rays a pixel, into layer `job.layerBase` of `job.output` (a storage
 * array of `r32float`), over `job.rect` (the drawn image by default), the rays cast through the scene's triangles of this image
 * (`rays`: the lighting made them for it). With `job.hits` (a storage array of `r32float`, the same layer) the light's visibility is written whole there and the distance of the nearest blocker
 * beside it, for the denoiser (`../denoise/`); without it a sun's is taken into the mask by the minimum. `views` are the surfaces' views (the normals at 1, the flags at 3).
 * Nothing while the stage compiles; whether it ran.
 */
export function runRayTracedShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  rays: SceneRays,
  job: {
    rank: number
    samples: number
    output: GPUTextureView
    hits?: GPUTextureView
    layerBase?: number
    rect?: SelfShadowRect
  },
  views: readonly GPUTextureView[],
) {
  const { device } = rt.gpu
  const hiz = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  const lightBuffer = rt.lights.buffer
  const surfaces = rt.gpu.surfaces
  if (!device || !hiz || !lightView || !lightBuffer || !rt.gpu.reflection || !surfaces) return false
  const kit = kitOf(device)
  kit.stage ??= askedComputeStage(
    device,
    [kit.layout, reflectionLayout(device), kit.scene],
    rayTracedProgram(),
    RAY_TRACED_ENTRY,
    'Trillion3D ray traced shadow',
    (error) => rt.diag.engineDiagnostic('ray-traced-shadow', String(error), {}),
  )
  const pipeline = kit.stage.get()
  if (!pipeline) return false
  // Stamped only once the pipeline exists: a view that never got one has nothing to let go.
  tracedAt.set(viewKey(rt.gpu), rt.run.frame)
  const [width, height] = rt.gpu.targetSize
  const [x0, y0, x1, y1] = job.rect ?? [0, 0, width, height]
  const { ints: words, floats } = kit
  words.set([width, height, 0, job.layerBase ?? 0], 0)
  words.set([x0, y0, x1, y1], 4)
  floats.set(
    [
      Math.max(settings.rayTracedShadowsNormalBias, LEAST_BIAS_CM) * CM,
      settings.rayTracedShadowsAvoidSelfIntersectionTraceDistance * CM,
      LEAST_BIAS_CM * CM,
      0,
    ],
    8,
  )
  words.set(
    [
      noiseFrame(rt),
      settings.rayTracedShadowsTwoSidedGeometry ? 1 : 0,
      settings.rayTracedShadowsAcceptFirstHit ? 1 : 0,
      job.hits ? 1 : 0,
    ],
    12,
  )
  floats.set([job.rank, job.samples, 0, 0], LIGHT_AT)
  floats.set(
    [
      settings.rayTracedShadowsLODTransitionStart * CM,
      settings.rayTracedShadowsLODTransitionEnd * CM,
      settings.rayTracedShadowsDirectionalLightTraceDistance * CM,
      0,
    ],
    LOD_AT,
  )
  const { uniforms, groups: cache } = runsOf.of(viewKey(rt.gpu), device)
  const params = uniforms.next(device, encoder)
  device.queue.writeBuffer(params.buffer, 0, kit.words)
  const { nodes, frames, worlds, tree } = rays.views
  const group = groupFor(
    device,
    cache,
    `run${params.index}`,
    kit.layout,
    [
      params.buffer,
      views[1],
      views[3],
      job.output,
      lightBuffer,
      job.hits ?? kit.idle,
      surfaces.subsurfaceView,
      nodes,
      frames,
      worlds,
      tree,
    ],
    () => [
      { binding: B.params, resource: { buffer: params.buffer } },
      { binding: B.normals, resource: views[1]! },
      { binding: B.flags, resource: views[3]! },
      { binding: B.mask, resource: job.output },
      { binding: B.lights, resource: { buffer: lightBuffer } },
      { binding: B.hits, resource: job.hits ?? kit.idle },
      { binding: B.subsurface, resource: surfaces.subsurfaceView },
      ...dagReadGroupEntries(rays.views),
    ],
  )
  const pass = encoder.beginComputePass({ label: 'vsm.rayTracedShadow' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, reflectionGroup(rt.gpu.reflection, hiz, lightView, skyLightReadOf(rt)))
  pass.setBindGroup(
    RAY_TRACED_SCENE.group,
    kit.sceneGroup(kit.scene, rays.sceneTrace, RAY_TRACED_SCENE.first),
  )
  pass.dispatchWorkgroups(ceilDiv(x1 - x0, RAY_TRACED_GROUP), ceilDiv(y1 - y0, RAY_TRACED_GROUP), 1)
  pass.end()
  return true
}
