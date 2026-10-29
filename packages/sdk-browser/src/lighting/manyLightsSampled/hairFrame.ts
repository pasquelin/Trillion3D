/**
 * THE SAMPLED LIGHTING OF THE HAIR STRANDS IN THE FRAME (`hairWgsl.ts`): the draws of the lights of each strand sample and the transmittance of the strands toward them, made before the strands are lit
 * (`hair/lighting.ts`), which reads them in place of the walk of the cell's lights.
 */
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { askedComputeProgram } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import type { HairNodes } from '../../hair/compactionPass.ts'
import type { HairVoxelSettings } from '../../hair/inputs.ts'
import type { HairVoxelSet } from '../../hair/voxelPass.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { directTiles } from '../../frame/render/encodeLights.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { strandNodeEntries } from '../../hair/environment.ts'
import { followSampledLights } from './frame.ts'
import {
  sampledDownsampleFactor,
  sampledMinSampleWeightEstimate,
  sampledSamplesForInput,
} from './parameters.ts'
import {
  HAIR_DRAW_WORDS,
  HAIR_MASK_ENTRY,
  HAIR_PARAMS_WORDS,
  HAIR_SAMPLED_BINDING as B,
  HAIR_SAMPLE_ENTRY,
  hairMaskWgsl,
  hairSampleWgsl,
} from './hairWgsl.ts'
import { directLightResources } from '../../frame/prepare/contractLight.ts'

/** The draws of the strands' samples the lighting reads, and how many each sample holds. */
export interface SampledHair {
  readonly draws: GPUBuffer
  /** The draws of a sample (4 at most) and whether the directional lights are drawn too: the word `HairLightParams` holds. */
  readonly word: number
}

const ro = (binding: number) => computeBufferEntry(binding, 'read-only-storage')

interface DeviceHair {
  sample: ReturnType<typeof askedComputeProgram>
  masks: Map<boolean, ReturnType<typeof askedComputeProgram>>
  params: GPUBuffer
  draws?: GPUBuffer
  capacity: number
}
const devices = new WeakMap<GPUDevice, DeviceHair>()

function deviceOf(rt: WebgpuPagesRuntime, device: GPUDevice): DeviceHair {
  let held = devices.get(device)
  if (held) return held
  const failed = (error: unknown) =>
    rt.diag.diagnosticFailure('sampled-lights-program-failed', error)
  held = {
    sample: askedComputeProgram(
      device,
      failed,
      `${HAIR_STRANDS_PASS_PREFIX}sampled draws`,
      [
        ...strandNodeEntries(B),
        computeBufferEntry(B.draws, 'storage'),
        computeUniformEntry(B.view),
        computeUniformEntry(B.params),
        ro(B.lights),
        ro(B.tiles),
      ],
      hairSampleWgsl(),
      HAIR_SAMPLE_ENTRY,
    ),
    masks: new Map(),
    params: device.createBuffer({
      label: `${HAIR_STRANDS_PASS_PREFIX}sampled params`,
      size: HAIR_PARAMS_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    capacity: 0,
  }
  devices.set(device, held)
  return held
}

const maskStage = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: DeviceHair,
  mipmap: boolean,
) => {
  let made = held.masks.get(mipmap)
  if (!made) {
    const failed = (error: unknown) =>
      rt.diag.diagnosticFailure('sampled-lights-program-failed', error)
    held.masks.set(
      mipmap,
      (made = askedComputeProgram(
        device,
        failed,
        `${HAIR_STRANDS_PASS_PREFIX}sampled masks`,
        [
          computeUniformEntry(0),
          ro(1),
          ro(2),
          ro(3),
          ro(B.nodeCoord),
          ro(B.nodeData),
          ro(B.nodeCounter),
          computeBufferEntry(B.draws, 'storage'),
          computeUniformEntry(B.view),
          computeUniformEntry(B.params),
          ro(B.lights),
        ],
        hairMaskWgsl(mipmap),
        HAIR_MASK_ENTRY,
      )),
    )
  }
  return made
}

/** Whether the strands are lit by the sampled lighting this image: it is on with the strands among its inputs, and its passes are compiled (asked now). */
export function sampledHairReady(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  voxel: HairVoxelSettings | undefined,
) {
  const values = followSampledLights(rt)
  if (!values.sampledLights || !values.sampledLightsHairStrands) return false
  const held = deviceOf(rt, device)
  const masks = voxel ? maskStage(rt, device, held, voxel.mipTraversal) : undefined
  return held.sample.pipeline.ready && (!masks || masks.pipeline.ready)
}

/** The buffer of draws, grown where the samples of the strands outgrow it (the one it replaces retired). */
function ensureDraws(device: GPUDevice, held: ReturnType<typeof deviceOf>, words: number) {
  if (!held.draws || held.capacity < words) {
    if (held.draws) retire(device, held.draws)
    held.draws = device.createBuffer({
      label: `${HAIR_STRANDS_PASS_PREFIX}sampled draws`,
      size: words * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    held.capacity = words
  }
  return held.draws
}

/** The sampling's uniform of an image: the eye, the noise, the fibre's components, the downsample, the tiles, the weights and the transmittance's settings. */
function hairParams(
  rt: WebgpuPagesRuntime,
  input: {
    values: ReturnType<typeof followSampledLights>
    count: number
    tiles: ReturnType<typeof directTiles>
    eye: ArrayLike<number>
    voxels: { settings: HairVoxelSettings } | undefined
    components: number
  },
) {
  const { values, count, tiles, eye, voxels } = input
  const data = new ArrayBuffer(HAIR_PARAMS_WORDS * 4)
  const f = new Float32Array(data)
  const u = new Uint32Array(data)
  f.set([eye[0]!, eye[1]!, eye[2]!, 1], 0)
  const [bx, by] = sampledDownsampleFactor(values, 'hair')
  u.set(
    [
      noiseFrame(rt) >>> 0,
      count,
      (values.sampledLightsDirectional ? 1 : 0) | (input.components << 1),
      bx | (by << 4),
      tiles[1]!,
      tiles[2]!,
    ],
    4,
  )
  f.set([sampledMinSampleWeightEstimate(values), values.sampledLightsMinSampleWeight], 10)
  f.set(
    [
      voxels?.settings.densityScaleTransmittance ?? 0,
      voxels?.settings.depthBiasScaleTransmittance ?? 0,
      voxels?.settings.steppingScaleTransmittance ?? 0,
      preExposureOf(rt).now,
    ],
    12,
  )
  return data
}

/** The bind group of the pass that masks the draws by the strands' voxels: the voxels, the nodes, the draws, the view, the uniform and the lights, bound in order. */
function maskGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  bound: {
    voxels: { set: HairVoxelSet }
    nodes: HairNodes
    draws: GPUBuffer
    viewBuffer: GPUBuffer
    params: GPUBuffer
    lights: GPUBuffer
  },
) {
  const { set } = bound.voxels
  const { nodes } = bound
  return device.createBindGroup({
    layout,
    entries: sequentialEntries([
      { buffer: set.paramsBuffer },
      { buffer: set.nodes },
      { buffer: set.pageIndex },
      { buffer: set.voxels },
      { buffer: nodes.nodeCoord },
      { buffer: nodes.nodeData },
      { buffer: nodes.nodeCounter },
      { buffer: bound.draws },
      { buffer: bound.viewBuffer },
      { buffer: bound.params },
      { buffer: bound.lights },
    ]),
  })
}

/**
 * Draws the lights of each sample of the strands and traces their transmittance through the voxels, into the buffer of draws (grown, the one it replaces retired). `voxels` the strands' volume and the settings of its
 * transmittance, none: the masks are left empty (all visible). Call only where `sampledHairReady` holds.
 */
export function encodeSampledHair(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  nodes: HairNodes,
  viewBuffer: GPUBuffer,
  eye: ArrayLike<number>,
  voxels: { set: HairVoxelSet; settings: HairVoxelSettings } | undefined,
  fibre: { lut: GPUTextureView; sampler: GPUSampler; components: number },
): SampledHair {
  const values = followSampledLights(rt)
  const held = deviceOf(rt, device)
  const [nx, ny] = sampledSamplesForInput(values, 'hair')
  const count = nx * ny
  const words = Math.max(nodes.capacity * count * HAIR_DRAW_WORDS, 4)
  const draws = ensureDraws(device, held, words)
  const direct = directLightResources(rt)
  const tiles = directTiles()
  const data = hairParams(rt, { values, count, tiles, eye, voxels, components: fibre.components })
  device.queue.writeBuffer(held.params, 0, data)
  const placeholders = rt.gpu.deferred!.placeholders
  const lights = direct.lights!
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}sampled lights` })
  pass.setPipeline(held.sample.pipeline.get()!)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: held.sample.layout,
      entries: [
        { binding: B.nodeCoord, resource: { buffer: nodes.nodeCoord } },
        { binding: B.nodeData, resource: { buffer: nodes.nodeData } },
        { binding: B.nodeCounter, resource: { buffer: nodes.nodeCounter } },
        { binding: B.draws, resource: { buffer: draws } },
        { binding: B.view, resource: { buffer: viewBuffer } },
        { binding: B.params, resource: { buffer: held.params } },
        { binding: B.lights, resource: { buffer: lights } },
        { binding: B.tiles, resource: { buffer: direct.tiles ?? placeholders.tiles } },
        { binding: B.lut, resource: fibre.lut },
        { binding: B.lut + 1, resource: fibre.sampler },
      ],
    }),
  )
  pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
  if (voxels) {
    const stage = maskStage(rt, device, held, voxels.settings.mipTraversal)
    pass.setPipeline(stage.pipeline.get()!)
    pass.setBindGroup(
      0,
      maskGroup(device, stage.layout, {
        voxels,
        nodes,
        draws,
        viewBuffer,
        params: held.params,
        lights,
      }),
    )
    pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
  }
  pass.end()
  return { draws, word: count | (values.sampledLightsDirectional ? 8 : 0) }
}

/** Frees the strands' passes of a device (a session's dispose). */
export function disposeSampledHair(device: GPUDevice) {
  const held = devices.get(device)
  held?.params.destroy()
  held?.draws?.destroy()
  devices.delete(device)
}
