import { noiseViewOn } from '../gpu/noise/blueNoiseTextures.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { startedComputeStages } from '../gpu/core/computeStages.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { skyLightReadOf } from '../frame/render/skyLightState.ts'
import type { ScreenProbeStage } from '../lighting/bounce/screen/stage.ts'
import { reflectionGroup } from '../lighting/reflections/group.ts'
import { reflectionLayout } from '../lighting/reflections/reflectionPipelines.ts'
import { REFLECTION_GROUP } from '../lighting/reflections/viewLayout.ts'
import { volumetricLightmapOf } from '../lighting/volumetricLightmap/frame.ts'
import { volumetricLightmapLayoutEntries } from '../lighting/volumetricLightmap/textures.ts'
import { lightingPhase } from '../lighting/surfaceCache/lighting/phase.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import {
  HAIR_ENV_ENTRY,
  HAIR_ENV_GROUP,
  HAIR_ENV_PARAM_WORDS,
  hairEnvKernel,
  hairEnvSkyProgram,
  type HairEnvironmentMode,
} from './envWgsl.ts'
import { HAIR_LIGHT_FORMAT, hairLightSide, hairLutSampler } from './hairLightPass.ts'
import {
  HAIR_STATIC_ENTRY,
  HAIR_STATIC_GROUP,
  HAIR_STATIC_LIGHTMAP_FIRST,
  hairStaticLightWgsl,
} from './staticLightWgsl.ts'
import type { HairViewGpu } from './viewGpu.ts'

/** The pixels a strand's screen ray is marched over, the reference's `ScreenTraceLength` twice. */
const SCREEN_TRACE_LENGTH = 256

/** The grid the environment's light is written to (a texel a sample, the grid of the strands' light) and the parameters of the kernel. */
function allocateEnvironment(allocator: ResourceAllocator, side: number) {
  return {
    grid: allocator.texture('environment light', [side, side], HAIR_LIGHT_FORMAT, {
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }),
    params: allocator.buffer('environment parameters', HAIR_ENV_PARAM_WORDS, 'uniform'),
  }
}

/** What the environment keeps with its resources: the words of its parameters, the kernel's group 2 over the samples, the table and (for the integrations that trace the voxels) the volume it was made for,
 *  the integration of the image, whether a kernel ran in the image, and the stage of each integration the screen probes' pass is given. */
interface EnvironmentExtra {
  readonly side: number
  readonly words: ReturnType<typeof wordViews>
  group?: {
    mode: HairEnvironmentMode
    nodes: object
    lut: GPUTextureView
    voxels: object | undefined
    noise: GPUTextureView | undefined
    made: GPUBindGroup
  }
  /** The integration of this image: the setting's, or the default where the volume it traces is none. */
  mode: HairEnvironmentMode
  /** Whether a kernel ran in this image: the sky pass of the strands reads the grid then, else computes the sky light's. */
  ran: boolean
  /** Whether the grid holds the static light of the volumetric lightmap (`encodeHairStaticLight`): the sky pass adds it to the sky light's. */
  staticLit: boolean
  readonly stages: Partial<Record<HairEnvironmentMode, ScreenProbeStage>>
}

/** The strands' environment light of a view, kept with it (`HairViewGpu.environment`). */
export type HairEnvironment = ReturnType<typeof allocateEnvironment> & EnvironmentExtra & HeldSet

/** The layout of the kernel's own group (group 2) for the integration `mode`. */
const envLayout = (device: GPUDevice, mode: HairEnvironmentMode) => {
  const G = HAIR_ENV_GROUP
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: 'read-only-storage' },
  })
  return device.createBindGroupLayout({
    label: `${HAIR_STRANDS_PASS_PREFIX}environment ${mode}`,
    entries: [
      storage(G.nodeCoord),
      storage(G.nodeData),
      storage(G.nodeCounter),
      {
        binding: G.lut,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'float', viewDimension: '3d' },
      },
      { binding: G.lut + 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: G.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: G.out,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: HAIR_LIGHT_FORMAT },
      },
      ...(mode === 'sh'
        ? []
        : [
            {
              binding: G.voxelParams,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'uniform' as const },
            },
            storage(G.voxelNodes),
            storage(G.voxelPageIndex),
            storage(G.voxels),
          ]),
      ...(mode === 'uniform'
        ? [
            {
              binding: G.blueNoise,
              visibility: GPUShaderStage.COMPUTE,
              texture: { sampleType: 'unfilterable-float' as const },
            },
          ]
        : []),
    ],
  })
}

/**
 * THE STRANDS' ENVIRONMENT LIGHT, armed before the screen probes are cast: while the image holds lit strands and the table of the fibre, a kernel of the integration the settings
 * name (`hairEnvironmentIntegration`) gathers the light along its directions into a grid the strands' sky pass reads (`environment.ran`). Where the world is lit by probes the kernel is a
 * stage of the screen probes' pass, reading the radiance cache (`WebgpuBounceState.stage`); else `encodeHairEnvironment` runs it where the sky light is the source. The `adhoc` and `uniform`
 * integrations trace the strands' voxels: without them the default (`sh`) is taken. The grid exists whenever the strands do.
 */
export function armHairEnvironment(rt: WebgpuPagesRuntime, device: GPUDevice, view: HairViewGpu) {
  const nodes = view.record?.nodes
  const { inputs } = view
  if (view.environment) view.environment.ran = view.environment.staticLit = false
  rt.bounce.stage = undefined
  if (!view.visible || !nodes) return
  const side = hairLightSide(nodes.capacity)
  const made = ensureSet<ReturnType<typeof allocateEnvironment>, EnvironmentExtra>(
    view.environment,
    device,
    {
      key: [side],
      what: 'the environment light of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}environment`,
    },
    (allocator) => allocateEnvironment(allocator, side),
    () => ({
      side,
      words: wordViews(new ArrayBuffer(HAIR_ENV_PARAM_WORDS * 4)),
      mode: 'sh',
      ran: false,
      staticLit: false,
      stages: {},
    }),
  )
  if (!made.resources) return
  const env = (view.environment = made.resources)
  const sky = inputs.sky
  env.mode = sky && view.voxel.set && inputs.voxel ? sky.integration : 'sh'
  const { u, f } = env.words
  u[0] = inputs.components ?? 0
  u[1] = sky?.sampleCount ?? 1
  u[2] = lightingPhase(rt)
  u[3] = inputs.voxel?.jitterMode ?? 0
  f[4] = sky?.distanceThreshold ?? 0
  f[5] = inputs.voxel?.densityScaleEnvironment ?? 0
  f[6] = inputs.voxel?.depthBiasScaleEnvironment ?? 0
  f[7] = inputs.voxel?.steppingScaleEnvironment ?? 1
  u[8] = sky?.screenTrace ? 1 : 0
  f[10] = SCREEN_TRACE_LENGTH
  writeChanged(device, env.params, u, 0, HAIR_ENV_PARAM_WORDS)
  // The stage runs only where the table of the fibre and the cache are there to read.
  if (view.lut && rt.bounce.probes?.cache)
    rt.bounce.stage = env.stages[env.mode] ??= {
      key: `hair-environment-${env.mode}`,
      entry: HAIR_ENV_ENTRY,
      block: hairEnvKernel(env.mode, 'cache'),
      layout: (gpu) => envLayout(gpu, env.mode),
      encode: (pass) => dispatchEnvironment(device, pass, view),
    }
}

/** The kernel's group 2 over the samples and the table, and the volume the integration traces (made again when one moved). */
function groupOf(device: GPUDevice, view: HairViewGpu, env: HairEnvironment) {
  const nodes = view.record!.nodes
  const lut = view.lut!.view
  const volume = env.mode === 'sh' ? undefined : view.voxel.set
  const noise = env.mode === 'uniform' ? noiseViewOn(device) : undefined
  const held = env.group
  if (
    held &&
    held.mode === env.mode &&
    held.nodes === nodes &&
    held.lut === lut &&
    held.voxels === volume &&
    held.noise === noise
  )
    return held.made
  const G = HAIR_ENV_GROUP
  const made = device.createBindGroup({
    layout: envLayout(device, env.mode),
    entries: [
      ...sequentialEntries([
        { buffer: nodes.nodeCoord },
        { buffer: nodes.nodeData },
        { buffer: nodes.nodeCounter },
        lut,
        hairLutSampler(device),
        { buffer: env.params },
        env.grid,
      ]),
      ...(volume
        ? [
            { binding: G.voxelParams, resource: { buffer: volume.paramsBuffer } },
            { binding: G.voxelNodes, resource: { buffer: volume.nodes } },
            { binding: G.voxelPageIndex, resource: { buffer: volume.pageIndex } },
            { binding: G.voxels, resource: { buffer: volume.voxels } },
          ]
        : []),
      ...(env.mode === 'uniform' ? [{ binding: G.blueNoise, resource: noiseViewOn(device) }] : []),
    ],
  })
  env.group = { mode: env.mode, nodes, lut, voxels: volume, noise, made }
  return made
}

/** Dispatches the kernel over the stored samples in `pass`, its pipeline set (group 2 only). */
function dispatchEnvironment(device: GPUDevice, pass: GPUComputePassEncoder, view: HairViewGpu) {
  const env = view.environment
  if (!env || !view.record || !view.lut) return
  pass.setBindGroup(2, groupOf(device, view, env))
  pass.dispatchWorkgroupsIndirect(view.record.nodes.nodeArgs, 0)
  env.ran = true
}

/** The sky gather's kernels of a device, compiled off the frame, by integration. */
const skyKernels = new WeakMap<
  GPUDevice,
  Map<HairEnvironmentMode, ReturnType<typeof startedSkyKernel>>
>()

function startedSkyKernel(device: GPUDevice, mode: HairEnvironmentMode) {
  const label = `${HAIR_STRANDS_PASS_PREFIX}environment ${mode} sky`
  const empty = device.createBindGroupLayout({ entries: [] })
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({
      bindGroupLayouts: [empty, reflectionLayout(device), envLayout(device, mode)],
    }),
    device.createShaderModule({ label, code: hairEnvSkyProgram(mode) }),
    [HAIR_ENV_ENTRY],
  )
  return {
    empty: device.createBindGroup({ layout: empty, entries: [] }),
    get ready() {
      return stages.ready
    },
    pipeline: () => stages.pipelineOf(HAIR_ENV_ENTRY),
  }
}

/**
 * The environment light of the strands where no probe cast it in this image (`environment.ran` false) and the integration is not the default: the kernel of the `mode` runs as a pass of its own, gathering
 * the sky light along its directions. The reflection group is the frame's (the depth pyramid its screen ray marches, the lighting's view, the sky light). Nothing while the kernel compiles or the frame
 * lacks the reflection (the sky pass then takes the sky light as the default does).
 */
export function encodeHairEnvironment(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: HairViewGpu,
) {
  const env = view.environment
  const { reflection } = rt.gpu
  const depth = rt.vis.gpuHiz?.depth()
  const lightView = rt.gpu.deferred?.uniform
  if (
    !env ||
    env.ran ||
    env.mode === 'sh' ||
    !view.record ||
    !view.lut ||
    !reflection ||
    !depth ||
    !lightView
  )
    return
  let byMode = skyKernels.get(device)
  if (!byMode) skyKernels.set(device, (byMode = new Map()))
  let kernel = byMode.get(env.mode)
  if (!kernel) byMode.set(env.mode, (kernel = startedSkyKernel(device, env.mode)))
  if (!kernel.ready) return
  const pass = encoder.beginComputePass({
    label: `${HAIR_STRANDS_PASS_PREFIX}environment ${env.mode} sky`,
  })
  pass.setPipeline(kernel.pipeline())
  pass.setBindGroup(0, kernel.empty)
  pass.setBindGroup(
    REFLECTION_GROUP,
    reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt)),
  )
  dispatchEnvironment(device, pass, view)
  pass.end()
}

/** The kernel of the static light of a device, compiled off the frame: its layouts, its pipeline and the group of its parameters. */
const staticKernels = new WeakMap<GPUDevice, ReturnType<typeof startedStaticKernel>>()

/** The layout of the static kernel's own group (group 1). */
const staticLayout = (device: GPUDevice) => {
  const G = HAIR_STATIC_GROUP
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: 'read-only-storage' },
  })
  return device.createBindGroupLayout({
    label: `${HAIR_STRANDS_PASS_PREFIX}static light`,
    entries: [
      storage(G.nodeCoord),
      storage(G.nodeData),
      storage(G.nodeCounter),
      {
        binding: G.lut,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'float', viewDimension: '3d' },
      },
      { binding: G.lut + 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: G.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: G.view, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: G.out,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: HAIR_LIGHT_FORMAT },
      },
    ],
  })
}

function startedStaticKernel(device: GPUDevice) {
  const label = `${HAIR_STRANDS_PASS_PREFIX}static light`
  const lightmap = device.createBindGroupLayout({
    entries: volumetricLightmapLayoutEntries(HAIR_STATIC_LIGHTMAP_FIRST, GPUShaderStage.COMPUTE),
  })
  const own = staticLayout(device)
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({ bindGroupLayouts: [lightmap, own] }),
    device.createShaderModule({ label, code: hairStaticLightWgsl }),
    [HAIR_STATIC_ENTRY],
  )
  return {
    own,
    get ready() {
      return stages.ready
    },
    pipeline: () => stages.pipelineOf(HAIR_STATIC_ENTRY),
  }
}

/**
 * The static light of the strands where the world is lit by no probe and the integration is the default: the volumetric lightmap's light along the direction each sample is lit from, written to the
 * grid the sky pass adds to the sky light (`environment.staticLit`). Nothing where the scene has no lightmap, a probe cast the light (`environment.ran`) or the kernel compiles.
 */
export function encodeHairStaticLight(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: HairViewGpu,
) {
  const env = view.environment
  const lightmap = volumetricLightmapOf(rt, device)
  const uniform = rt.gpu.deferred?.uniform
  if (!env || env.ran || env.mode !== 'sh' || !lightmap || !uniform || !view.record || !view.lut)
    return
  let kernel = staticKernels.get(device)
  if (!kernel) staticKernels.set(device, (kernel = startedStaticKernel(device)))
  if (!kernel.ready) return
  const nodes = view.record.nodes
  const G = HAIR_STATIC_GROUP
  const pipeline = kernel.pipeline()
  const pass = encoder.beginComputePass({ label: `${HAIR_STRANDS_PASS_PREFIX}static light` })
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: lightmap.entries(HAIR_STATIC_LIGHTMAP_FIRST),
    }),
  )
  pass.setBindGroup(
    1,
    device.createBindGroup({
      layout: kernel.own,
      entries: [
        ...sequentialEntries([
          { buffer: nodes.nodeCoord },
          { buffer: nodes.nodeData },
          { buffer: nodes.nodeCounter },
          view.lut.view,
          hairLutSampler(device),
          { buffer: env.params },
        ]),
        { binding: G.view, resource: { buffer: uniform } },
        { binding: G.out, resource: env.grid },
      ],
    }),
  )
  pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
  pass.end()
  env.staticLit = true
}
