import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { TAA_PASS } from '../../diagnostic/stage/passLabels.ts'
import { FULL_ANALYSIS, type AnalysisWork } from './levels.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { resolveTargetUsage, taaPass } from './resolve.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { GUARANTEED_WORKGROUP_BYTES, workgroupStorageBytes } from '../../gpu/core/textureLimits.ts'
import { velocityInputEntries, velocityInputResources, type TaaInputs } from './inputs.ts'
import type { TilePlan } from './tileWgsl.ts'
import { CLOSEST_FORMAT, MARKS_FORMAT, TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'
import { VELOCITY_BINDINGS, velocityShader } from './nearestVelocityWgsl.ts'
import {
  REPROJECT_BINDINGS,
  REPROJECTED_FORMAT,
  SHADING_HISTORY_FORMAT,
  FLICKER_FORMAT,
  reprojectShader,
} from './reprojectWgsl.ts'
import {
  FLICKER_BINDINGS,
  FLICKER_ERROR_FORMAT,
  FLICKER_PLAN,
  flickerPlanFor,
  flickerShader,
} from './flickerWgsl.ts'
import {
  THIN_GEOMETRY_BINDINGS,
  THIN_GEOMETRY_FORMAT,
  THIN_GEOMETRY_PLAN,
  thinGeometryShader,
} from './thinGeometryWgsl.ts'
import {
  HELD_MEASURE_BINDINGS,
  HELD_MEASURE_FORMAT,
  HELD_MEASURE_PLAN,
  heldMeasureShader,
  REJECTION_BINDINGS,
  REJECTION_FORMAT,
  REJECTION_PLAN,
  rejectionShader,
} from './rejectionWgsl.ts'
import {
  ANTI_ALIASING_FORMAT,
  ANTI_ALIAS_NEUTRAL,
  LDR_LUMA_FORMAT,
  SPATIAL_AA_BINDINGS,
  spatialAntiAliasingShader,
} from './spatialAntiAliasingWgsl.ts'

/** The closest occluders scattered where they stood: a word per render texel, and a second one
 *  under an orthographic projection (`velocityWgsl.ts`), made by the first orthographic image. */
const OCCLUDER_BYTES = 4

/** The render-resolution targets of one image, each named by what it holds between which passes:
 *  the hole-filled vectors (`filled`) are the history's; the flicker error is written over the
 *  closest depth word, which the reprojection last reads (`FLICKER_ERROR_FORMAT`). The vectors the
 *  reprojection starts from are the velocity stage's (`../velocity.ts`), which the motion blur reads
 *  after the pass: none is kept here. */
const TRANSIENT_FORMATS = {
  closest: CLOSEST_FORMAT,
  filled: VECTOR_FORMAT,
  reprojected: REPROJECTED_FORMAT,
  marks: MARKS_FORMAT,
  shadingReprojected: SHADING_HISTORY_FORMAT,
  flickerThenLuma: FLICKER_FORMAT,
  rejection: REJECTION_FORMAT,
  filteredInput: HELD_MEASURE_FORMAT,
  filteredHistory: HELD_MEASURE_FORMAT,
  filteredError: HELD_MEASURE_FORMAT,
} as const
/** The render-resolution histories, one of each: the reprojection reads them into the image's
 *  targets, and a later pass writes each for the next image. */
const RENDER_HISTORY_FORMATS = {
  shading: SHADING_HISTORY_FORMAT,
  flicker: FLICKER_FORMAT,
  thin: THIN_GEOMETRY_FORMAT,
}

const bytesOf = (formats: Record<string, GPUTextureFormat>) =>
  Object.values(formats).reduce((bytes, format) => bytes + texelBytesOf(format), 0)

/** Bytes per render pixel of the analysis: its targets, the anti-aliaser's, the render-resolution
 *  histories and a perspective's occluder word — an orthographic view adds one word more. */
export const ANALYSIS_BYTES_PER_PIXEL =
  bytesOf(TRANSIENT_FORMATS) +
  texelBytesOf(ANTI_ALIASING_FORMAT) +
  bytesOf(RENDER_HISTORY_FORMATS) +
  OCCLUDER_BYTES

/** What the analysis reads of the frame (`TaaInputs`), in its groups' identity order. */
const ANALYSIS_INPUTS = [
  'current',
  'depth',
  'ids',
  'pages',
  'motion',
  'vectors',
  'pool',
  'positions',
  'uvs',
  'boxes',
  'reactive',
] as const

/** The flicker measure built over the tile the device's workgroup memory allows, with the plan it
 *  was built over; a pipeline whose compile refuses it anyway — a compiled kernel caps its threads
 *  by what it uses, which no limit names — is built over the narrow plan, the one every device
 *  holds. `stage` compiles one program of the analysis. */
async function flickerStage(
  device: GPUDevice,
  stage: (
    layout: GPUBindGroupLayout,
    module: Promise<GPUShaderModule>,
    entryPoint: string,
  ) => ReturnType<typeof buildComputeStage>,
  layout: GPUBindGroupLayout,
) {
  const bytes = workgroupStorageBytes(device.limits)
  const built = async (plan: TilePlan, workgroupBytes: number) => ({
    plan,
    pipeline: await stage(
      layout,
      createCheckedShaderModule(device, flickerShader(plan, workgroupBytes), 'TAA_FLICKER'),
      'flickerMeasure',
    ),
  })
  const wanted = flickerPlanFor(bytes)
  return built(wanted, bytes).catch((error) => {
    if (wanted === FLICKER_PLAN) throw error
    return built(FLICKER_PLAN, GUARANTEED_WORKGROUP_BYTES)
  })
}

/** The render texels a workgroup of each dispatch covers, across and down, in their order: the
 *  nearest velocity and the reprojection, a texel a lane, the thin geometry detection, the flicker
 *  measure (of the `flicker` plan the device's workgroup memory allows), the held measure and the
 *  rejection, a tile each. */
const tilesOf = (flicker: TilePlan) =>
  [
    [TEXEL_TILE, TEXEL_TILE],
    [TEXEL_TILE, TEXEL_TILE],
    [THIN_GEOMETRY_PLAN.width, THIN_GEOMETRY_PLAN.height],
    [flicker.width, flicker.height],
    [HELD_MEASURE_PLAN.width, HELD_MEASURE_PLAN.height],
    [REJECTION_PLAN.width, REJECTION_PLAN.height],
  ] as const
/** The thin geometry detection's and the flicker measure's places among them. */
const THIN_DISPATCH = 2
const FLICKER_DISPATCH = 3
/** The compute pass they share. */
const COMPUTE_PASS: GPUComputePassDescriptor = { label: TAA_PASS }

/**
 * The temporal pass's render-resolution analysis, before the history update, each pass a dispatch
 * of one compute pass over the rendered size of targets made at the render targets' size
 * (`allocate`), the largest a frame is drawn at:
 * 1. the nearest velocity (`velocityWgsl.ts`), which scatters the occluder words;
 * 2. the history reprojection (`reprojectWgsl.ts`), which reads the render-resolution histories the
 *    last image wrote into this image's targets, and the occluder words;
 * 3. the thin geometry detection (`thinGeometryWgsl.ts`), which writes the thin geometry history
 *    and this image's mask, where the level runs it (`AnalysisWork`);
 * 4. the flicker measure (`flickerWgsl.ts`), which writes the flicker history, where the level
 *    runs it (`AnalysisWork`);
 * 5. the held measure (`rejectionWgsl.ts`), the filtered input and history the rejection clamps,
 *    which empties the occluder words for the next image — none before the first, made empty;
 * 6. the shading rejection (`rejectionWgsl.ts`), which writes the shading history;
 * 7. the spatial anti-aliaser (`spatialAntiAliasingWgsl.ts`), a fullscreen draw.
 * The groups that name the frame's inputs follow their identity, two held — the lit image is one of
 * two targets taking turns —; those that name only the analysis's own targets are made with them.
 */
export async function createTaaAnalysis(
  device: GPUDevice,
  sampler: GPUSampler,
  uniform: GPUBuffer,
) {
  const compute = GPUShaderStage.COMPUTE
  const layoutOf = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  const readOnly = (binding: number) => computeBufferEntry(binding, 'read-only-storage', compute)
  const velocityLayout = layoutOf([
    ...velocityInputEntries(),
    computeStorageTextureEntry(VELOCITY_BINDINGS.closest, CLOSEST_FORMAT),
    computeStorageTextureEntry(VELOCITY_BINDINGS.marks, MARKS_FORMAT),
    computeBufferEntry(VELOCITY_BINDINGS.occluders, 'storage', compute),
  ])
  const reprojectLayout = layoutOf([
    computeUniformEntry(REPROJECT_BINDINGS.view),
    computeTextureEntry(REPROJECT_BINDINGS.marks, 'uint'),
    computeTextureEntry(REPROJECT_BINDINGS.closest, 'uint'),
    computeTextureEntry(REPROJECT_BINDINGS.vectors, 'uint'),
    readOnly(REPROJECT_BINDINGS.occluders),
    computeTextureEntry(REPROJECT_BINDINGS.prevShading, 'float'),
    computeSamplerEntry(REPROJECT_BINDINGS.historySampler, 'filtering'),
    computeTextureEntry(REPROJECT_BINDINGS.prevFlicker, 'float'),
    computeStorageTextureEntry(REPROJECT_BINDINGS.shading, SHADING_HISTORY_FORMAT),
    computeStorageTextureEntry(REPROJECT_BINDINGS.flicker, FLICKER_FORMAT),
    computeStorageTextureEntry(REPROJECT_BINDINGS.word, REPROJECTED_FORMAT),
    computeStorageTextureEntry(REPROJECT_BINDINGS.filled, VECTOR_FORMAT),
    computeTextureEntry(REPROJECT_BINDINGS.prevThin, 'uint'),
  ])
  const thinLayout = layoutOf([
    computeUniformEntry(THIN_GEOMETRY_BINDINGS.view),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.depth, 'depth'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.ids, 'uint'),
    readOnly(THIN_GEOMETRY_BINDINGS.pages),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.marks, 'uint'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.word, 'uint'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(THIN_GEOMETRY_BINDINGS.reactive, 'float'),
    computeStorageTextureEntry(THIN_GEOMETRY_BINDINGS.thinOut, THIN_GEOMETRY_FORMAT),
  ])
  const flickerLayout = layoutOf([
    computeUniformEntry(FLICKER_BINDINGS.view),
    computeTextureEntry(FLICKER_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(FLICKER_BINDINGS.reactive, 'float'),
    computeTextureEntry(FLICKER_BINDINGS.word, 'uint'),
    computeTextureEntry(FLICKER_BINDINGS.flicker, 'float'),
    computeTextureEntry(FLICKER_BINDINGS.marks, 'uint'),
    computeStorageTextureEntry(FLICKER_BINDINGS.flickerOut, FLICKER_FORMAT),
    computeStorageTextureEntry(FLICKER_BINDINGS.error, FLICKER_ERROR_FORMAT),
    computeTextureEntry(FLICKER_BINDINGS.thin, 'uint'),
  ])
  const rejectionLayout = layoutOf([
    computeUniformEntry(REJECTION_BINDINGS.view),
    computeTextureEntry(REJECTION_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(REJECTION_BINDINGS.word, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.shading, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.flicker, 'uint'),
    computeStorageTextureEntry(REJECTION_BINDINGS.shadingOut, SHADING_HISTORY_FORMAT),
    computeStorageTextureEntry(REJECTION_BINDINGS.rejection, REJECTION_FORMAT),
    computeStorageTextureEntry(REJECTION_BINDINGS.luma, LDR_LUMA_FORMAT),
    computeTextureEntry(REJECTION_BINDINGS.flickerHistory, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.reactive, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.marks, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.thin, 'uint'),
    computeTextureEntry(REJECTION_BINDINGS.filteredInput, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.filteredHistory, 'float'),
    computeTextureEntry(REJECTION_BINDINGS.filteredError, 'float'),
  ])
  const heldLayout = layoutOf([
    computeUniformEntry(HELD_MEASURE_BINDINGS.view),
    computeTextureEntry(HELD_MEASURE_BINDINGS.current, 'unfilterable-float'),
    computeTextureEntry(HELD_MEASURE_BINDINGS.word, 'uint'),
    computeTextureEntry(HELD_MEASURE_BINDINGS.shading, 'float'),
    computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredInput, HELD_MEASURE_FORMAT),
    computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredHistory, HELD_MEASURE_FORMAT),
    computeStorageTextureEntry(HELD_MEASURE_BINDINGS.filteredError, HELD_MEASURE_FORMAT),
    computeBufferEntry(HELD_MEASURE_BINDINGS.occluders, 'storage', compute),
  ])
  const fragment = GPUShaderStage.FRAGMENT
  const aaLayout = layoutOf([
    computeTextureEntry(SPATIAL_AA_BINDINGS.luma, 'float', '2d', fragment),
    computeUniformEntry(SPATIAL_AA_BINDINGS.view, {}, fragment),
    computeSamplerEntry(SPATIAL_AA_BINDINGS.lumaSampler, 'filtering', fragment),
    computeTextureEntry(SPATIAL_AA_BINDINGS.rejection, 'float', '2d', fragment),
  ])
  // Each text is compiled at its call, so the call names what it compiles.
  const stage = async (
    layout: GPUBindGroupLayout,
    module: Promise<GPUShaderModule>,
    entryPoint: string,
  ) => {
    const compiled = await module
    return buildComputeStage(device, [layout], compiled, entryPoint, undefined, compiled.label)
  }
  const [
    velocityPipeline,
    reprojectPipeline,
    thinPipeline,
    flickerBuilt,
    heldPipeline,
    rejectionPipeline,
    aaPipeline,
  ] = await Promise.all([
    stage(
      velocityLayout,
      createCheckedShaderModule(device, velocityShader(), 'TAA_VELOCITY'),
      'nearestVelocity',
    ),
    stage(
      reprojectLayout,
      createCheckedShaderModule(device, reprojectShader(), 'TAA_REPROJECT'),
      'reprojectHistories',
    ),
    stage(
      thinLayout,
      createCheckedShaderModule(device, thinGeometryShader(), 'TAA_THIN_GEOMETRY'),
      'detectThinGeometry',
    ),
    flickerStage(device, stage, flickerLayout),
    stage(
      heldLayout,
      createCheckedShaderModule(device, heldMeasureShader(), 'TAA_HELD_MEASURE'),
      'heldMeasure',
    ),
    stage(
      rejectionLayout,
      createCheckedShaderModule(device, rejectionShader(), 'TAA_REJECTION'),
      'shadingRejection',
    ),
    createCheckedShaderModule(device, spatialAntiAliasingShader(), 'TAA_SPATIAL_AA').then(
      (module) =>
        makeFullscreenPipeline(device, module, aaLayout, 'spatialAntiAliasing', [
          { format: ANTI_ALIASING_FORMAT },
        ]),
    ),
  ])
  const tiles = tilesOf(flickerBuilt.plan)
  /** The dispatches' pipelines, in the order of `tiles`. */
  const pipelines = [
    velocityPipeline,
    reprojectPipeline,
    thinPipeline,
    flickerBuilt.pipeline,
    heldPipeline,
    rejectionPipeline,
  ]
  const textures: GPUTexture[] = []
  const identity = createWebgpuBindIdentity(2),
    /** Per identity slot: each dispatch's group, in the order of `tiles`. */
    held: (GPUBindGroup[] | undefined)[] = []
  type Targets = Record<keyof typeof TRANSIENT_FORMATS, GPUTextureView> &
    Record<keyof typeof RENDER_HISTORY_FORMATS, GPUTextureView> & {
      antiAliasing: GPUTextureView
      occluders: GPUBuffer
      /** The occluder words a render texel has: one, two once an orthographic image was drawn. */
      occluderSlices: number
      aaGroup: GPUBindGroup
      aaPass: GPURenderPassDescriptor
      /** The anti-aliaser's target cleared to no offset and no noise filtering, no draw: what the
       *  history update reads where the level runs no anti-aliaser (`ANTI_ALIAS_NEUTRAL`). */
      aaNeutral: GPURenderPassDescriptor
      /** Whether the anti-aliaser's target holds its neutral word since it last drew. */
      aaNeutralHeld: boolean
    }
  let width = 0,
    height = 0,
    made: Targets | undefined
  const drop = () => {
    if (made) retire(device, made.occluders)
    for (const texture of textures) retire(device, texture)
    textures.length = 0
    made = undefined
    identity.clear()
    held.length = 0
    width = height = 0
  }
  const targets = () => {
    if (!made) throw new Error('TAA_ANALYSIS_TARGETS_MISSING')
    return made
  }
  const occluderBuffer = (slices: number) =>
    device.createBuffer({
      label: 'Trillion3D TAA closest occluders',
      size: slices * width * height * OCCLUDER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    })
  /** The reprojection's group: it reads the render-resolution histories and the velocity stage's
   *  `vectors` into the image's targets. */
  const reprojectGroupOf = (vectors: GPUTextureView, t: Targets) =>
    device.createBindGroup({
      layout: reprojectLayout,
      entries: namedEntries(REPROJECT_BINDINGS, {
        view: { buffer: uniform },
        marks: t.marks,
        closest: t.closest,
        vectors,
        occluders: { buffer: t.occluders },
        prevShading: t.shading,
        historySampler: sampler,
        prevFlicker: t.flicker,
        shading: t.shadingReprojected,
        flicker: t.flickerThenLuma,
        word: t.reprojected,
        filled: t.filled,
        prevThin: t.thin,
      }),
    })
  /** The second occluder word of every render texel, for the first orthographic image: the groups
   *  that name the words are made again. */
  const addOccluderSlice = (t: Targets) => {
    retire(device, t.occluders)
    t.occluders = occluderBuffer(2)
    t.occluderSlices = 2
    identity.clear()
    held.length = 0
  }
  /** The dispatches' groups naming the frame's `inputs`, for its identity. */
  const inputGroups = (inputs: TaaInputs, t: Targets) => {
    const { next } = identity
    for (let i = 0; i < ANALYSIS_INPUTS.length; i++) next[i] = inputs[ANALYSIS_INPUTS[i]]
    const moved = identity.moved()
    const kept = held[identity.slot]
    if (!moved && kept) return kept
    const uniformEntry = { buffer: uniform }
    const groups = [
      device.createBindGroup({
        layout: velocityLayout,
        entries: namedEntries(VELOCITY_BINDINGS, {
          ...velocityInputResources(inputs, uniform),
          closest: t.closest,
          marks: t.marks,
          occluders: { buffer: t.occluders },
        }),
      }),
      reprojectGroupOf(inputs.vectors, t),
      device.createBindGroup({
        layout: thinLayout,
        entries: namedEntries(THIN_GEOMETRY_BINDINGS, {
          view: uniformEntry,
          depth: inputs.depth,
          ids: inputs.ids,
          pages: { buffer: inputs.pages },
          marks: t.marks,
          word: t.reprojected,
          current: inputs.current,
          reactive: inputs.reactive!,
          thinOut: t.thin,
        }),
      }),
      device.createBindGroup({
        layout: flickerLayout,
        entries: namedEntries(FLICKER_BINDINGS, {
          view: uniformEntry,
          current: inputs.current,
          reactive: inputs.reactive!,
          word: t.reprojected,
          flicker: t.flickerThenLuma,
          marks: t.marks,
          flickerOut: t.flicker,
          error: t.closest,
          thin: t.thin,
        }),
      }),
      device.createBindGroup({
        layout: heldLayout,
        entries: namedEntries(HELD_MEASURE_BINDINGS, {
          view: uniformEntry,
          current: inputs.current,
          word: t.reprojected,
          shading: t.shadingReprojected,
          filteredInput: t.filteredInput,
          filteredHistory: t.filteredHistory,
          filteredError: t.filteredError,
          occluders: { buffer: t.occluders },
        }),
      }),
      device.createBindGroup({
        layout: rejectionLayout,
        entries: namedEntries(REJECTION_BINDINGS, {
          view: uniformEntry,
          current: inputs.current,
          word: t.reprojected,
          shading: t.shadingReprojected,
          flicker: t.closest,
          shadingOut: t.shading,
          rejection: t.rejection,
          luma: t.flickerThenLuma,
          flickerHistory: t.flicker,
          reactive: inputs.reactive!,
          marks: t.marks,
          thin: t.thin,
          filteredInput: t.filteredInput,
          filteredHistory: t.filteredHistory,
          filteredError: t.filteredError,
        }),
      }),
    ]
    held[identity.slot] = groups
    return groups
  }
  return {
    /** Bytes of the targets as allocated. */
    get bytes() {
      if (!made) return 0
      return (
        width * height * (ANALYSIS_BYTES_PER_PIXEL + (made.occluderSlices - 1) * OCCLUDER_BYTES)
      )
    },
    /** The size the targets are made at, 0 × 0 before `allocate`. */
    get width() {
      return width
    },
    get height() {
      return height
    },
    /** Makes the targets at `w × h`, their groups that name no input and the anti-aliaser's pass,
     *  the former ones dropped: the render-resolution histories start empty. */
    allocate(w: number, h: number) {
      drop()
      width = w
      height = h
      const size = { width: w, height: h }
      const stored = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      const target = (label: string, format: GPUTextureFormat, usage = stored) => {
        const texture = device.createTexture({ label, size, format, usage })
        textures.push(texture)
        return texture.createView()
      }
      const named = <Name extends string>(
        formats: Record<Name, GPUTextureFormat>,
        suffix: string,
      ) =>
        Object.fromEntries(
          Object.entries<GPUTextureFormat>(formats).map(([name, format]) => [
            name,
            target(`Trillion3D TAA ${name}${suffix}`, format),
          ]),
        ) as Record<Name, GPUTextureView>
      const transient = named(TRANSIENT_FORMATS, '')
      const antiAliasing = target(
        'Trillion3D TAA spatial anti-aliasing',
        ANTI_ALIASING_FORMAT,
        resolveTargetUsage(),
      )
      const own = {
        ...transient,
        ...named(RENDER_HISTORY_FORMATS, ' history'),
        antiAliasing,
        occluders: occluderBuffer(1),
        occluderSlices: 1,
        aaGroup: device.createBindGroup({
          layout: aaLayout,
          entries: namedEntries(SPATIAL_AA_BINDINGS, {
            luma: transient.flickerThenLuma,
            view: { buffer: uniform },
            lumaSampler: sampler,
            rejection: transient.rejection,
          }),
        }),
        aaPass: taaPass([antiAliasing]),
        aaNeutralHeld: false,
        aaNeutral: {
          label: TAA_PASS,
          colorAttachments: [
            {
              view: antiAliasing,
              loadOp: 'clear' as const,
              storeOp: 'store' as const,
              clearValue: [ANTI_ALIAS_NEUTRAL, 0, 0, 0],
            },
          ],
        },
      }
      made = own
    },
    /** Each render texel's hole-filled reprojection vector (`TAA_BINDINGS.vectors`). */
    get vectors() {
      return targets().filled
    },
    /** Each render texel's shading rejection (`TAA_BINDINGS.rejection`). */
    get rejection() {
      return targets().rejection
    },
    /** The anti-aliaser's offset and noise filtering (`TAA_BINDINGS.antiAliasing`). */
    get antiAliasing() {
      return targets().antiAliasing
    },
    /** Encodes the analysis of the frame's `inputs` over the `render` size, drawn through an
     *  `orthographic` projection or not: the dispatches in one compute pass, then the anti-aliaser's
     *  draw — the `work` the level runs (`AnalysisWork`). Without the flicker measure, its
     *  dispatch is left out: the rejection reads no flicker error (`view.quality.x`), its history
     *  waits unwritten — an image running it again drops the history (`encodeTaaPass`); likewise
     *  the thin geometry detection, which the passes that read its mask then read none of
     *  (`view.quality.w`). The held measure, which runs at every level, empties the occluder
     *  words. Without the anti-aliaser, its target is cleared to its neutral word once, no draw,
     *  until it draws again. */
    encode(
      encoder: GPUCommandEncoder,
      inputs: TaaInputs,
      render: readonly [number, number],
      orthographic: boolean,
      work: AnalysisWork = FULL_ANALYSIS,
    ) {
      const t = targets()
      const slices = orthographic ? 2 : 1
      if (slices > t.occluderSlices) addOccluderSlice(t)
      const groups = inputGroups(inputs, t)
      const w = render[0],
        h = render[1]
      const dispatches = encoder.beginComputePass(COMPUTE_PASS)
      for (let s = 0; s < tiles.length; s++) {
        if (s === THIN_DISPATCH && !work.thin) continue
        if (s === FLICKER_DISPATCH && !work.flicker) continue
        dispatches.setPipeline(pipelines[s])
        dispatches.setBindGroup(0, groups[s])
        dispatches.dispatchWorkgroups(ceilDiv(w, tiles[s][0]), ceilDiv(h, tiles[s][1]))
      }
      dispatches.end()
      // Without the anti-aliaser, its target is cleared to its neutral word once, until it draws.
      if (!work.antiAlias) {
        if (!t.aaNeutralHeld) encoder.beginRenderPass(t.aaNeutral).end()
        t.aaNeutralHeld = true
        return
      }
      t.aaNeutralHeld = false
      const pass = encoder.beginRenderPass(t.aaPass)
      pass.setViewport(0, 0, w, h, 0, 1)
      pass.setPipeline(aaPipeline)
      pass.setBindGroup(0, t.aaGroup)
      pass.draw(3)
      pass.end()
    },
    release: drop,
  }
}
