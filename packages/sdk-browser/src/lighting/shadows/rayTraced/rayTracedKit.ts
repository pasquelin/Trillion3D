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
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
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
const PARAM_WORDS = LIGHT_AT + 4

/** What the kernel is made of on a device: its group 0 layout, the stage (asked once, off the frame), the scene trace's binder and the uniforms, one a run of the image. */
const kitOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D ray traced shadow',
    entries: [
      computeUniformEntry(B.params),
      computeTextureEntry(B.normals, 'unfilterable-float'),
      computeTextureEntry(B.flags, 'uint'),
      computeStorageTextureEntry(B.mask, 'r32float', 'read-write', '2d-array'),
      computeBufferEntry(B.lights, 'read-only-storage'),
      ...dagReadLayoutEntries(),
    ],
  })
  const scene = hardwareTraceLayout(device)
  return {
    layout,
    scene,
    sceneGroup: sceneTraceGroupBinder(device),
    words: new ArrayBuffer(PARAM_WORDS * 4),
    uniforms: { frame: -1, used: 0, buffers: [] as GPUBuffer[] },
    stage: undefined as ReturnType<typeof askedComputeStage> | undefined,
  }
})

/** The uniform of the run the image is at, a buffer for each run of an image: the runs are encoded before any is submitted. */
function uniformFor(kit: ReturnType<typeof kitOf>, device: GPUDevice, frame: number) {
  const { uniforms } = kit
  if (uniforms.frame !== frame) {
    uniforms.frame = frame
    uniforms.used = 0
  }
  return (uniforms.buffers[uniforms.used++] ??= device.createBuffer({
    label: 'Trillion3D ray traced shadow params',
    size: PARAM_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
}

/**
 * THE RAY TRACED SHADOW KERNEL (`rayTracedWgsl.ts`) run for the light of rank `job.rank`, `job.samples` rays a pixel, into layer `job.layerBase` of `job.output` (a storage
 * array of `r32float`), over `job.rect` (the drawn image by default), the rays cast through the scene's triangles of this image
 * (`rays`: the lighting made them for it).. `views` are the surfaces' views (the normals at 1, the flags at 3).
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
    layerBase?: number
    rect?: SelfShadowRect
  },
  views: readonly GPUTextureView[],
) {
  const { device } = rt.gpu
  const hiz = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  const lightBuffer = rt.lights.buffer
  if (!device || !hiz || !lightView || !lightBuffer || !rt.gpu.reflection) return false
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
  const [width, height] = rt.gpu.targetSize
  const [x0, y0, x1, y1] = job.rect ?? [0, 0, width, height]
  const words = new Uint32Array(kit.words),
    floats = new Float32Array(kit.words)
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
      0,
    ],
    12,
  )
  floats.set([job.rank, job.samples, 0, 0], LIGHT_AT)
  const params = uniformFor(kit, device, rt.run.frame)
  device.queue.writeBuffer(params, 0, kit.words)
  const group = device.createBindGroup({
    layout: kit.layout,
    entries: [
      { binding: B.params, resource: { buffer: params } },
      { binding: B.normals, resource: views[1]! },
      { binding: B.flags, resource: views[3]! },
      { binding: B.mask, resource: job.output },
      { binding: B.lights, resource: { buffer: lightBuffer } },
      ...dagReadGroupEntries(rays.views),
    ],
  })
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
