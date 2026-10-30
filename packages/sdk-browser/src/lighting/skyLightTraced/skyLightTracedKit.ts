import { dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { startedComputeStage } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { SUBSURFACE_FORMAT } from '../../materials/surface/subsurface.ts'
import { hizLevelZeroEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { skyLightDiffuseLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
  REFLECTION_VIEW_BYTES,
} from '../reflections/viewLayout.ts'
import { sceneMaskKey, type SceneMaskPrograms } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceGroupBinder } from '../rays/sceneTrace/sceneTraceGroup.ts'
import { SKY_MODEL_BINDINGS as M } from './skyLightTracedModelWgsl.ts'
import {
  SKY_COMPOSITE_BINDINGS as C,
  SKY_COMPOSITE_ENTRY,
  SKY_RAYS_BINDINGS as R,
  SKY_RAYS_ENTRY,
  SKY_TRACE_BINDINGS as T,
  SKY_TRACE_ENTRY,
  SKY_TRACE_HAIR as H,
  SKY_TRACE_SCENE,
  skyCompositeProgram,
  skyRaysProgram,
  skyTraceProgram,
} from './skyLightTracedWgsl.ts'

/** The formats of what the trace writes: the light with the share of the rays that hit in its alpha, and the distance of the hits with the number of rays. */
export const SKY_LIGHT_FORMAT: GPUTextureFormat = 'rgba16float'
export const SKY_OPEN_FORMAT: GPUTextureFormat = 'rg32float'

/** The words of the parameters of the trace (six vectors); the pass of the directions and the composite read the first of them. */
export const SKY_PARAM_WORDS = 24

/** The light added to the lit image: its colour summed with what lies there, nothing of its alpha. */
const ADDITIVE: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
}

/**
 * What the ray-traced sky light is made of on a device: the layouts of its three passes (the directions', the trace's with the scene trace's group, the composite's), the stage of the
 * directions and of the composite (started once, off the frame), the stage of the trace for each set of graph masks (`stageOf`, started once for a set; `hairStageOf`, the same with the strands' voxels in a group after the scene trace's) and the scene trace's binder.
 */
export const skyLightTracedKit = oncePerDevice((device: GPUDevice) => {
  const words = new ArrayBuffer(SKY_PARAM_WORDS * 4)
  const rays = device.createBindGroupLayout({
    label: 'Trillion3D sky light directions',
    entries: [
      computeUniformEntry(R.params),
      computeBufferEntry(R.rays, 'storage'),
      computeTextureEntry(R.skyTexture, 'unfilterable-float'),
      computeTextureEntry(R.skyPdf, 'unfilterable-float'),
    ],
  })
  const trace = device.createBindGroupLayout({
    label: 'Trillion3D sky light trace',
    entries: [
      computeUniformEntry(T.params),
      computeTextureEntry(T.normals, 'unfilterable-float'),
      computeTextureEntry(T.flags, 'uint'),
      computeStorageTextureEntry(T.light, SKY_LIGHT_FORMAT, 'write-only'),
      computeStorageTextureEntry(T.open, SKY_OPEN_FORMAT, 'write-only'),
      computeBufferEntry(T.rays, 'read-only-storage'),
      computeTextureEntry(T.skyTexture, 'unfilterable-float'),
      computeTextureEntry(T.skyPdf, 'unfilterable-float'),
      computeTextureEntry(M.base, 'unfilterable-float'),
      computeBufferEntry(M.lights, 'read-only-storage'),
      computeTextureEntry(M.emissiveAo, 'unfilterable-float'),
      computeStorageTextureEntry(M.subsurface, SUBSURFACE_FORMAT, 'read-only'),
      computeBufferEntry(M.toon, 'read-only-storage'),
      ...dagReadLayoutEntries(),
    ],
  })
  // The trace reads of the reflection group (`REFLECTION_GROUP`) its view, the first level of the depth, the lighting's view and the sky light's harmonics: not the pyramid, the lit image,
  // the front depth nor the cubes, which would spend three more of the stage's sixteen sampled textures.
  const view = device.createBindGroupLayout({
    label: 'Trillion3D sky light trace view',
    entries: [
      computeUniformEntry(REFLECTION_VIEW_BINDING, { minBindingSize: REFLECTION_VIEW_BYTES }),
      ...hizLevelZeroEntries(REFLECTION_DEPTH_BINDING, COMPUTE),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform'),
      ...skyLightDiffuseLayoutEntries(REFLECTION_SKY_LIGHT, COMPUTE),
    ],
  })
  const scene = device.createBindGroupLayout({
    label: 'Trillion3D sky light trace scene trace',
    entries: sceneMaskedLayoutEntries(SKY_TRACE_SCENE.first),
  })
  const fragment = GPUShaderStage.FRAGMENT
  const composite = device.createBindGroupLayout({
    label: 'Trillion3D sky light composite',
    entries: [
      computeTextureEntry(C.sky, 'unfilterable-float', '2d', fragment),
      computeTextureEntry(C.base, 'unfilterable-float', '2d', fragment),
      computeUniformEntry(C.params, {}, fragment),
      computeTextureEntry(C.flags, 'uint', '2d', fragment),
    ],
  })
  const directions = startedComputeStage(
    device,
    [rays],
    skyRaysProgram(),
    SKY_RAYS_ENTRY,
    'Trillion3D sky light directions',
  )
  const additive = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      device.createShaderModule({
        label: 'Trillion3D sky light composite',
        code: skyCompositeProgram(),
      }),
      composite,
      SKY_COMPOSITE_ENTRY,
      [{ format: HDR_FORMAT, blend: ADDITIVE }],
      'Trillion3D sky light composite',
    ),
  ).start()
  // The strands' voxels, bound by the variant of the trace that marches through them (the group after the scene trace's).
  const voxels = device.createBindGroupLayout({
    label: 'Trillion3D sky light trace hair voxels',
    entries: [
      computeUniformEntry(H.params),
      computeBufferEntry(H.nodes, 'read-only-storage'),
      computeBufferEntry(H.pageIndex, 'read-only-storage'),
      computeBufferEntry(H.voxels, 'read-only-storage'),
    ],
  })
  /** The stage of each set of graph masks the rays cut by, started once, for the trace without the strands' voxels and for the one with them: no frame waits for a candidate, the one the image binds is asked by `get`. */
  const stageMaker = (hairVoxel: boolean) => {
    const stages = new WeakMap<SceneMaskPrograms, ReturnType<typeof startedComputeStage>>()
    return (programs: SceneMaskPrograms) => {
      let stage = stages.get(programs)
      if (!stage) {
        stage = startedComputeStage(
          device,
          hairVoxel ? [trace, view, scene, voxels] : [trace, view, scene],
          skyTraceProgram(programs, hairVoxel),
          SKY_TRACE_ENTRY,
          `Trillion3D sky light trace ${hairVoxel ? 'hair voxels ' : ''}${sceneMaskKey(programs)}`,
        )
        stages.set(programs, stage)
      }
      return stage
    }
  }
  return {
    rays,
    trace,
    view,
    scene,
    composite,
    voxels,
    directions,
    additive,
    stageOf: stageMaker(false),
    hairStageOf: stageMaker(true),
    sceneGroup: sceneTraceGroupBinder(device),
    words,
    ints: new Uint32Array(words),
    floats: new Float32Array(words),
  }
})
