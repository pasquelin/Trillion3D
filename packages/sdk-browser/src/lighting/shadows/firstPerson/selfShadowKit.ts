import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import {
  computeBufferEntry,
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
import { selfShadowWindows, type SelfShadowRect } from './selfShadowWindow.ts'
import {
  SELF_SHADOW_BINDINGS as B,
  SELF_SHADOW_ENTRIES,
  SELF_SHADOW_GROUP,
  SELF_SHADOW_MAX_LIGHTS,
  selfShadowProgram,
} from './selfShadowWgsl.ts'

type SelfShadowEntry = (typeof SELF_SHADOW_ENTRIES)[keyof typeof SELF_SHADOW_ENTRIES]

/** The shader's mode of the downsample for each setting (0 the closest, 1 the farthest, 2 the checkerboard): the reference remaps its setting to the shader's modes the same way
 *  (the shader's 0 keeps the lowest device depth, the farthest under the reversed depth). */
const DOWNSAMPLE_MODE = [1, 0, 2] as const

/** The words of the uniform: the sizes, the counts, the trace's numbers and a record a light. */
const PARAM_WORDS = 24 + 4 * SELF_SHADOW_MAX_LIGHTS
/** The word of the uniform the lights' records begin at: after the sizes, the counts, the trace's numbers, the window, its ends and the layer base. */
const LIGHTS_AT = 24
/** The least a depth threshold may be, as the reference's: the weights divide by it. */
const SMALL_NUMBER = 1e-8

/** The stages of the four kernels for a march that gives up on occupancy or never, the group 0 layout they share, and the uniforms a run is given:
 *  one a run of the image, since the runs of an image are encoded before any is submitted. */
const kitOf = oncePerDevice((device: GPUDevice) => {
  const entries = [
    computeUniformEntry(B.params),
    computeTextureEntry(B.normals, 'unfilterable-float'),
    computeTextureEntry(B.flags, 'uint'),
    computeStorageTextureEntry(B.downInputs, 'r32uint', 'read-write'),
    computeStorageTextureEntry(B.downDepth, 'r32float', 'read-write'),
    computeStorageTextureEntry(B.raw, 'r32float', 'read-write', '2d-array'),
    computeStorageTextureEntry(B.blurred, 'r32float', 'read-write', '2d-array'),
    computeStorageTextureEntry(B.lightMask, 'r32float', 'read-write', '2d-array'),
    computeBufferEntry(B.lights, 'read-only-storage'),
  ]
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D first person self shadow',
    entries,
  })
  const stages = new Map<string, ReturnType<typeof askedComputeStage>>()
  return {
    layout,
    uniforms: { frame: -1, used: 0, buffers: [] as GPUBuffer[] },
    /** What the encoder's first run downsampled: the later runs of it (other lights, other windows) read it as it is. */
    downsampled: undefined as { encoder: WeakRef<GPUCommandEncoder>; key: unknown[] } | undefined,
    words: new ArrayBuffer(PARAM_WORDS * 4),
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

/** The half-resolution grid's textures a device holds: their size and layers, the textures and their views. */
type Grid = { size: string; layers: number; list: GPUTexture[]; views: GPUTextureView[] }
const grids = new WeakMap<GPUDevice, Grid>()

/** The grid's textures let go (retired, as a size change retires them): nothing is held for a feature unused. */
export function releaseSelfShadowGrid(device: GPUDevice) {
  const old = grids.get(device)
  if (!old) return
  grids.delete(device)
  retire(device, { destroy: () => old.list.forEach((t) => t.destroy()) })
}

/** The textures of the half-resolution grid (made at `low` with a layer a light, retired when the size or the lights change) and their views. */
function texturesFor(device: GPUDevice, low: readonly [number, number], lights: number) {
  const size = low.join('x')
  const old = grids.get(device)
  // Made for the most lights asked at this size, so that a sun run and a local lights' run do not remake it by turns.
  if (old?.size === size && old.layers >= lights) return old.views
  lights = Math.max(lights, old?.size === size ? old.layers : 0)
  releaseSelfShadowGrid(device)
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
    make('shadow', 'r32float', lights),
    make('filtered', 'r32float', lights),
  ]
  const views = [
    list[0]!.createView(),
    list[1]!.createView(),
    arrayView(list[2]!),
    arrayView(list[3]!),
  ]
  grids.set(device, { size, layers: lights, list, views })
  return views
}

/** The uniform of the run the image is at: a buffer of the image's own, made when the image runs more than any before it. */
function uniformFor(kit: ReturnType<typeof kitOf>, device: GPUDevice, frame: number) {
  const { uniforms } = kit
  if (uniforms.frame !== frame) {
    uniforms.frame = frame
    uniforms.used = 0
  }
  return (uniforms.buffers[uniforms.used] ??= device.createBuffer({
    label: 'Trillion3D first person self shadow params',
    size: PARAM_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
}

/** Writes `buffer`: the drawn size and the grid's, the lights, the mode, the occupancy and the trace's numbers. */
function writeParams(
  kit: ReturnType<typeof kitOf>,
  device: GPUDevice,
  buffer: GPUBuffer,
  settings: ShadowValues,
  size: readonly [number, number],
  lights: Float32Array,
  count: number,
  window: readonly [number, number, number, number],
  ends: SelfShadowRect,
  layerBase: number,
) {
  const words = new Uint32Array(kit.words),
    floats = new Float32Array(kit.words)
  words.set([size[0], size[1], ceilDiv(size[0], 2), ceilDiv(size[1], 2)], 0)
  words.set(
    [
      count,
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
  words.set(window, 12)
  words.set(ends, 20)
  words.set([layerBase], 16)
  floats.set(lights.subarray(0, 4 * count), LIGHTS_AT)
  device.queue.writeBuffer(buffer, 0, kit.words)
}

/** The records of the lights of one run (`runSelfShadow`), filled by the callers and copied to the run's uniform before it returns: runs never overlap. */
export const selfShadowRecords = new Float32Array(4 * SELF_SHADOW_MAX_LIGHTS)

/**
 * THE KERNELS OF THE FIRST-PERSON SELF SHADOW (`selfShadowWgsl.ts`) run over `count` lights (`SELF_SHADOW_MAX_LIGHTS` at most; a caller with more runs them in turns), a layer each, their records
 * `lights` (four floats a light: a sun's direction toward it and 0, or a local light's rank and 1): the depth and the normal of the first-person pixels at
 * half the resolution (a pass, made once by an encoder for all its runs), a trace toward each light, its 3 x 3 filter and its upsample into the light's layer
 * (`layerBase` and up) of `output` (a storage array of `r32float`), each a pass over all the lights, over `rect` (the drawn image by default) and, at the half resolution, the
 * margin its readers need; at the full resolution (`shadowFirstPersonSelfShadowRawFullResolution`) the trace alone, into `output`.
 * A sun's layer takes the shadow by the minimum, a local light's is written, at the first-person pixels. Nothing while a stage compiles; whether it ran.
 * `views` are the surfaces' views (the normals at 1, the flags at 3).
 */
export function runSelfShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  job: {
    lights: Float32Array
    count: number
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
  if (!device || !hiz || !lightView || !lightBuffer || !rt.gpu.reflection || !job.count)
    return false
  const count = Math.min(job.count, SELF_SHADOW_MAX_LIGHTS)
  const kit = kitOf(device),
    size = rt.gpu.targetSize,
    raw = settings.shadowFirstPersonSelfShadowRawFullResolution,
    mode = settings.shadowFirstPersonSelfShadowDownsampleCheckerboardMode
  const polyfill = settings.shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy > 0
  const failed = (error: unknown) =>
    rt.diag.engineDiagnostic('first-person-self-shadow', String(error), {})
  const stages = Object.values(SELF_SHADOW_ENTRIES).map((entry) =>
    kit.stage(entry, polyfill, failed),
  )
  const [downsample, trace, blur, upsample] = stages.map((stage) => stage.get())
  if (!trace || (!raw && !(downsample && blur && upsample))) return false
  const allocated = rt.gpu.allocatedSize
  const lowSize = [ceilDiv(size[0], 2), ceilDiv(size[1], 2)] as const
  const grid = texturesFor(device, [ceilDiv(allocated[0], 2), ceilDiv(allocated[1], 2)], count)
  const { low, full } = selfShadowWindows(job.rect ?? [0, 0, size[0], size[1]], lowSize)
  const params = uniformFor(kit, device, rt.run.frame)
  kit.uniforms.used++
  writeParams(
    kit,
    device,
    params,
    settings,
    size,
    job.lights,
    count,
    [low[0], low[1], full[0], full[1]],
    [low[2], low[3], full[2], full[3]],
    job.layerBase ?? 0,
  )
  const group = device.createBindGroup({
    layout: kit.layout,
    entries: [
      { binding: B.params, resource: { buffer: params } },
      { binding: B.normals, resource: views[1]! },
      { binding: B.flags, resource: views[3]! },
      { binding: B.downInputs, resource: grid[0]! },
      { binding: B.downDepth, resource: grid[1]! },
      { binding: B.raw, resource: grid[2]! },
      { binding: B.blurred, resource: grid[3]! },
      { binding: B.lightMask, resource: job.output },
      { binding: B.lights, resource: { buffer: lightBuffer } },
    ],
  })
  const reflection = reflectionGroup(rt.gpu.reflection, hiz, lightView, skyLightReadOf(rt))
  const groups = (width: number, height: number) =>
    [ceilDiv(width, SELF_SHADOW_GROUP), ceilDiv(height, SELF_SHADOW_GROUP)] as const
  const pass = encoder.beginComputePass({ label: 'vsm.firstPersonSelfShadow' })
  pass.setBindGroup(0, group)
  pass.setBindGroup(1, reflection)
  const run = (pipeline: GPUComputePipeline, [x, y]: readonly [number, number], z: number) => {
    pass.setPipeline(pipeline)
    pass.dispatchWorkgroups(x, y, z)
  }
  const fullGroups = groups(full[2] - full[0], full[3] - full[1])
  if (raw) run(trace, fullGroups, count)
  else {
    // What the downsample reads and writes, and the encoder it was encoded in: a later run of that encoder reads it as it is.
    const key = [views[1], views[3], hiz, grid, lowSize[0], lowSize[1], rt.run.frame, mode]
    const held = kit.downsampled
    if (held?.encoder.deref() !== encoder || held.key.some((value, k) => value !== key[k])) {
      run(downsample!, groups(...lowSize), 1)
      kit.downsampled = { encoder: new WeakRef(encoder), key }
    }
    const lowGroups = groups(low[2] - low[0], low[3] - low[1])
    run(trace, lowGroups, count)
    run(blur!, lowGroups, count)
    run(upsample!, fullGroups, count)
  }
  pass.end()
  return true
}
