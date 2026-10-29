import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { askedComputeStage } from '../../../gpu/core/computeStages.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { arrayView } from '../../../gpu/core/textureViews.ts'
import { reflectionGroup, reflectionLightView } from '../../reflections/group.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { firstPersonBoundsOf } from '../../reflections/firstPersonBounds.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'
import {
  SELF_SHADOW_BINDINGS as B,
  SELF_SHADOW_ENTRIES,
  SELF_SHADOW_GROUP,
  SELF_SHADOW_MAX_SUNS,
  selfShadowProgram,
} from './selfShadowWgsl.ts'

type SelfShadowEntry = (typeof SELF_SHADOW_ENTRIES)[keyof typeof SELF_SHADOW_ENTRIES]

/** The words of the uniform: the sizes, the counts, the trace's numbers and a direction a sun. */
const PARAM_WORDS = 12 + 4 * SELF_SHADOW_MAX_SUNS
/** The least a depth threshold may be, as the reference's: the weights divide by it. */
const SMALL_NUMBER = 1e-8
/** The shader's mode of the downsample for each setting (0 the closest, 1 the farthest, 2 the checkerboard): the lowest device depth is the farthest. */
const DOWNSAMPLE_MODE = [1, 0, 2] as const

const bounds = new Float64Array(4)

/** Whether the pixels of the first-person objects take a screen shadow from the suns this image: the setting on for the suns, a first-person object in the scene and the
 *  screen reflection's trace layers made. */
export function firstPersonSelfShadowOn(rt: WebgpuPagesRuntime, shadows: ShadowValues) {
  return (
    shadows.shadowFirstPersonSelfShadow &&
    shadows.shadowFirstPersonSelfShadowLightTypes !== 1 &&
    !!rt.gpu.reflection &&
    firstPersonBoundsOf(rt, bounds)[3]! > 0
  )
}

/** The stages of the four kernels for a march that gives up on occupancy or never, and the group 0 layout they share. */
const kitOf = oncePerDevice((device: GPUDevice) => {
  const entries = [
    computeUniformEntry(B.params),
    computeTextureEntry(B.normals, 'unfilterable-float'),
    computeTextureEntry(B.flags, 'uint'),
    computeStorageTextureEntry(B.downInputs, 'r32uint', 'read-write'),
    computeStorageTextureEntry(B.downDepth, 'r32float', 'read-write'),
    computeStorageTextureEntry(B.raw, 'r32float', 'read-write', '2d-array'),
    computeStorageTextureEntry(B.blurred, 'r32float', 'read-write', '2d-array'),
    computeStorageTextureEntry(B.sunMask, 'r32float', 'read-write', '2d-array'),
  ]
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D first person self shadow',
    entries,
  })
  const stages = new Map<string, ReturnType<typeof askedComputeStage>>()
  return {
    layout,
    params: device.createBuffer({
      label: 'Trillion3D first person self shadow params',
      size: PARAM_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    words: new ArrayBuffer(PARAM_WORDS * 4),
    textures: undefined as { key: string; list: GPUTexture[]; views: GPUTextureView[] } | undefined,
    stage(entry: SelfShadowEntry, polyfill: boolean, failed: (error: unknown) => void) {
      const key = `${entry}|${polyfill}`
      let stage = stages.get(key)
      if (!stage) {
        stage = askedComputeStage(
          device,
          [layout, reflectionLayout(device)],
          selfShadowProgram(entry, polyfill ? 'polyfill' : 'none'),
          entry,
          `Trillion3D first person self shadow ${entry}`,
          failed,
        )
        stages.set(key, stage)
      }
      return stage
    },
  }
})

/** The textures of the half-resolution grid (made at `low` with a layer a sun, retired when the size or the suns change) and their views. */
function texturesFor(
  device: GPUDevice,
  kit: ReturnType<typeof kitOf>,
  low: readonly [number, number],
  suns: number,
) {
  const key = `${low.join('x')}x${suns}`
  if (kit.textures?.key === key) return kit.textures.views
  const old = kit.textures
  if (old) retire(device, { destroy: () => old.list.forEach((t) => t.destroy()) })
  const make = (label: string, format: GPUTextureFormat, layers: number) =>
    device.createTexture({
      label: `Trillion3D first person self shadow ${label}`,
      size: [low[0], low[1], layers],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING,
    })
  const list = [
    make('inputs', 'r32uint', 1),
    make('depth', 'r32float', 1),
    make('shadow', 'r32float', suns),
    make('filtered', 'r32float', suns),
  ]
  const views = [
    list[0]!.createView(),
    list[1]!.createView(),
    arrayView(list[2]!),
    arrayView(list[3]!),
  ]
  kit.textures = { key, list, views }
  return views
}

/** Writes the uniform: the drawn size and the grid's, the suns, the mode, the occupancy and the trace's numbers. */
function writeParams(
  kit: ReturnType<typeof kitOf>,
  device: GPUDevice,
  settings: ShadowValues,
  size: readonly [number, number],
  lights: readonly VsmProjectionLight[],
  suns: number,
) {
  const words = new Uint32Array(kit.words),
    floats = new Float32Array(kit.words)
  words.set([size[0], size[1], ceilDiv(size[0], 2), ceilDiv(size[1], 2)], 0)
  words.set(
    [
      suns,
      settings.shadowFirstPersonSelfShadowRawFullResolution ? 1 : 0,
      DOWNSAMPLE_MODE[settings.shadowFirstPersonSelfShadowDownsampleCheckerboardMode]!,
      settings.shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy,
    ],
    4,
  )
  floats.set(
    [
      settings.shadowFirstPersonSelfShadowMaxTraceDistance,
      settings.shadowFirstPersonSelfShadowMaxHzbTraceIterations,
      settings.shadowFirstPersonSelfShadowRelativeDepthThickness,
      1 / Math.max(SMALL_NUMBER, settings.shadowFirstPersonSelfShadowBilateralFilterDepthThreshold),
    ],
    8,
  )
  for (let k = 0; k < suns; k++) {
    const d = lights[k]!.direction
    floats.set([-d[0]!, -d[1]!, -d[2]!, 0], 12 + 4 * k)
  }
  device.queue.writeBuffer(kit.params, 0, kit.words)
}

/**
 * THE FIRST-PERSON SELF SHADOW OF THE SUNS (`selfShadowWgsl.ts`), after the projection has written the suns' mask: the depth and the normal of the
 * first-person pixels at half the resolution (a pass), a trace toward each sun, its 3 x 3 filter and its upsample into the sun's layer of `sunMask`
 * by the minimum, each a pass over all the suns (`SELF_SHADOW_MAX_SUNS` at most); at the full resolution (`shadowFirstPersonSelfShadowRawFullResolution`)
 * the trace alone, into the mask. Nothing while a stage compiles. `views` are the surfaces' views (the normals at 1, the flags at 3).
 */
export function encodeFirstPersonSelfShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  lights: readonly VsmProjectionLight[],
  suns: number,
  sunMask: GPUTextureView,
  views: readonly GPUTextureView[],
) {
  const { device } = rt.gpu
  const hiz = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  if (!device || !hiz || !lightView || !rt.gpu.reflection || !suns) return
  const count = Math.min(suns, SELF_SHADOW_MAX_SUNS)
  const kit = kitOf(device),
    size = rt.gpu.targetSize,
    raw = settings.shadowFirstPersonSelfShadowRawFullResolution
  const polyfill = settings.shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy > 0
  const failed = (error: unknown) =>
    rt.diag.engineDiagnostic('first-person-self-shadow', String(error), {})
  const stages = Object.values(SELF_SHADOW_ENTRIES).map((entry) =>
    kit.stage(entry, polyfill, failed),
  )
  const [downsample, trace, blur, upsample] = stages.map((stage) => stage.get())
  if (!trace || (!raw && !(downsample && blur && upsample))) return
  const allocated = rt.gpu.allocatedSize
  const grid = texturesFor(device, kit, [ceilDiv(allocated[0], 2), ceilDiv(allocated[1], 2)], count)
  writeParams(kit, device, settings, size, lights, count)
  const group = device.createBindGroup({
    layout: kit.layout,
    entries: [
      { binding: B.params, resource: { buffer: kit.params } },
      { binding: B.normals, resource: views[1]! },
      { binding: B.flags, resource: views[3]! },
      { binding: B.downInputs, resource: grid[0]! },
      { binding: B.downDepth, resource: grid[1]! },
      { binding: B.raw, resource: grid[2]! },
      { binding: B.blurred, resource: grid[3]! },
      { binding: B.sunMask, resource: sunMask },
    ],
  })
  const reflection = reflectionGroup(rt.gpu.reflection, hiz, lightView, skyLightReadOf(rt))
  const groups = (extent: readonly [number, number]) =>
    [ceilDiv(extent[0], SELF_SHADOW_GROUP), ceilDiv(extent[1], SELF_SHADOW_GROUP)] as const
  const lowGroups = groups([ceilDiv(size[0], 2), ceilDiv(size[1], 2)])
  const fullGroups = groups(size)
  const pass = encoder.beginComputePass({ label: 'vsm.firstPersonSelfShadow' })
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, reflection)
  const run = (pipeline: GPUComputePipeline, [x, y]: readonly [number, number], z: number) => {
    pass.setPipeline(pipeline)
    pass.dispatchWorkgroups(x, y, z)
  }
  if (raw) run(trace, fullGroups, count)
  else {
    run(downsample!, lowGroups, 1)
    run(trace, lowGroups, count)
    run(blur!, lowGroups, count)
    run(upsample!, fullGroups, count)
  }
  pass.end()
}
