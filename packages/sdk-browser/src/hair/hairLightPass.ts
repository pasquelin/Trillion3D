import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import type { HairNodes } from './compactionPass.ts'
import { hairLightPassWgsl, hairSkyPassWgsl, HAIR_LIGHT_GROUP } from './hairLightWgsl.ts'

/** The format of the strands' light: the rgb of each sample, multiplied by its coverage, and the coverage. */
export const HAIR_LIGHT_FORMAT: GPUTextureFormat = 'rgba16float'

/** The group 1 layout of the pass: the samples, the masks, the light slots, the parameters and the table. */
export const hairLightLayout = oncePerDevice((device) => {
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const storage = (binding: number, visibility: number): GPUBindGroupLayoutEntry => ({
    binding,
    visibility,
    buffer: { type: 'read-only-storage' },
  })
  const G = HAIR_LIGHT_GROUP
  return device.createBindGroupLayout({
    label: `${HAIR_STRANDS_PASS_PREFIX}light`,
    entries: [
      storage(G.nodeCoord, GPUShaderStage.FRAGMENT),
      storage(G.nodeData, GPUShaderStage.FRAGMENT),
      storage(G.nodeCounter, both),
      storage(G.transmittance, GPUShaderStage.FRAGMENT),
      storage(G.slots, GPUShaderStage.FRAGMENT),
      { binding: G.params, visibility: both, buffer: { type: 'uniform' } },
      {
        binding: G.lut,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '3d' },
      },
      {
        binding: G.lutSampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
      {
        binding: G.scene,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: G.env,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      // The draws of the sampled lighting (`manyLightsSampled/hairWgsl.ts`): read by the sampled form of the pass alone.
      storage(G.draws, GPUShaderStage.FRAGMENT),
    ],
  })
})

/** The sampler of the table of the fibre's scattering: bilinear, clamped to the edge. */
export const hairLutSampler = oncePerDevice((device) =>
  device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  }),
)

/**
 * The pipeline that lights the strands' samples, for the lights `key` describes: group 0 is `localLayout`, the
 * lit program's local lights' group layout (the resources the lights are lit through, bound by the program with
 * the masks of the strands in place of the surfaces'), group 1 the hair's (`hairLightLayout`). Made once for a
 * layout (the program's own): the pair of pipelines, the first batch's that writes the light and the next batches' that
 * add theirs to it; each `get()` gives its pipeline, none while it compiles.
 */
export function hairLightPipeline(
  device: GPUDevice,
  localLayout: GPUBindGroupLayout,
  key: ContractKey,
  label: string,
  sampled = false,
) {
  const pipelines = sampled ? sampledLightPipelines : lightPipelines
  let made = pipelines.get(localLayout)
  if (!made)
    pipelines.set(localLayout, (made = makeLightPipeline(device, localLayout, key, label, sampled)))
  return made
}

const lightPipelines = new WeakMap<GPUBindGroupLayout, ReturnType<typeof makeLightPipeline>>()
/** The pipelines of the form that lights the local lights from the draws of the sampled lighting. */
const sampledLightPipelines = new WeakMap<
  GPUBindGroupLayout,
  ReturnType<typeof makeLightPipeline>
>()

function makeLightPipeline(
  device: GPUDevice,
  localLayout: GPUBindGroupLayout,
  key: ContractKey,
  label: string,
  sampled: boolean,
) {
  const name = `${HAIR_STRANDS_PASS_PREFIX}light ${label}${sampled ? ' sampled' : ''}`
  const module = device.createShaderModule({
    label: name,
    code: wgslModule(hairLightPassWgsl(key, sampled)),
  })
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [localLayout, hairLightLayout(device)],
  })
  const variant = (blend?: GPUBlendState) =>
    preparedPipeline(device, {
      label: name,
      layout,
      vertex: { module, entryPoint: 'hairLightVs' },
      fragment: {
        module,
        entryPoint: 'hairLightMain',
        targets: [{ format: HAIR_LIGHT_FORMAT, blend }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    })
  return { first: variant(), next: variant(ADD_BLEND) }
}

/** The light of a pass added to the light already in the target. */
const ADD_BLEND: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'max', srcFactor: 'one', dstFactor: 'one' },
}

/**
 * The pipeline that adds the sky light to the strands' samples (the default integration, `hairSkyPassWgsl`): group 0 is
 * `indirectLayout`, the lit program's indirect group layout, group 1 the hair's. None while it compiles.
 */
export function hairSkyPipeline(
  device: GPUDevice,
  indirectLayout: GPUBindGroupLayout,
  cubed: boolean,
  label: string,
) {
  let made = skyPipelines.get(indirectLayout)
  if (!made)
    skyPipelines.set(indirectLayout, (made = makeSkyPipeline(device, indirectLayout, cubed, label)))
  return made
}

const skyPipelines = new WeakMap<GPUBindGroupLayout, ReturnType<typeof makeSkyPipeline>>()

function makeSkyPipeline(
  device: GPUDevice,
  indirectLayout: GPUBindGroupLayout,
  cubed: boolean,
  label: string,
) {
  const name = `${HAIR_STRANDS_PASS_PREFIX}sky ${label}`
  const module = device.createShaderModule({
    label: name,
    code: wgslModule(hairSkyPassWgsl(cubed)),
  })
  return preparedPipeline(device, {
    label: name,
    layout: device.createPipelineLayout({
      bindGroupLayouts: [indirectLayout, hairLightLayout(device)],
    }),
    vertex: { module, entryPoint: 'hairLightVs' },
    fragment: {
      module,
      entryPoint: 'hairSkyMain',
      targets: [{ format: HAIR_LIGHT_FORMAT, blend: ADD_BLEND }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  })
}

/** What the pass reads in its group 1. */
interface HairLightResources {
  readonly nodes: HairNodes
  /** The transmittance masks, a block of one word a sample for each lit light (`transmittance[slot * samples + sample]`). */
  readonly masks: GPUBuffer
  /** The slot of each light's block in `masks` by the light's rank, `HAIR_LIGHT_NO_SLOT` for none. */
  readonly slots: GPUBuffer
  /** `HairLightParams`: the samples' count, the components, the side of the target. */
  readonly params: GPUBuffer
  readonly lut: GPUTextureView
  /** The lit image the samples that scatter its light read. */
  readonly scene: GPUTextureView
  /** The strands' light from the radiance cache (`HAIR_ENV_KERNEL`), read where the sky pass is told to. */
  readonly env: GPUTextureView
  /** The draws of the sampled lighting, none: a stand-in the plain form never reads. */
  readonly draws?: GPUBuffer
}

/** The buffer the draws' binding holds where the pass is not the sampled form. */
const noDraws = oncePerDevice((device) =>
  device.createBuffer({
    label: `${HAIR_STRANDS_PASS_PREFIX}no sampled draws`,
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  }),
)

/** The group 1 of a frame's pass. */
export function hairLightGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  r: HairLightResources,
) {
  return device.createBindGroup({
    layout,
    entries: sequentialEntries([
      { buffer: r.nodes.nodeCoord },
      { buffer: r.nodes.nodeData },
      { buffer: r.nodes.nodeCounter },
      { buffer: r.masks },
      { buffer: r.slots },
      { buffer: r.params },
      r.lut,
      hairLutSampler(device),
      r.scene,
      r.env,
      { buffer: r.draws ?? noDraws(device) },
    ]),
  })
}

/** The side of the square the samples are laid on, for room for `capacity` of them. */
export const hairLightSide = (capacity: number) => Math.max(1, Math.ceil(Math.sqrt(capacity)))

/**
 * Draws a pass over the strands' samples into `target` (a `HAIR_LIGHT_FORMAT` texture of `hairLightSide(capacity)`
 * squared): the light's, cleared to nothing, or the sky's, added to the light (`add`). One triangle over the grid the
 * samples fill, the fragments past their count dropped. `group0` is the lit program's local group, made with the
 * strands' masks, or its indirect group.
 */
export function encodeHairLight(
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  group0: GPUBindGroup,
  group1: GPUBindGroup,
  target: GPUTextureView,
  add = false,
) {
  const pass = encoder.beginRenderPass({
    label: `${HAIR_STRANDS_PASS_PREFIX}light`,
    colorAttachments: [
      {
        view: target,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: add ? 'load' : 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group0)
  pass.setBindGroup(1, group1)
  pass.draw(3)
  pass.end()
}
