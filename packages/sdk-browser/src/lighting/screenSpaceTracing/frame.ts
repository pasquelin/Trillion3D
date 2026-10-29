import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchOn } from '../../gpu/core/computeStages.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import type { ScreenReflectionQuality } from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import {
  REDUCED_COLOR_MIPS,
  SCREEN_SPACE_GROUP_SIDE,
  SCREEN_SPACE_GROUP_THREADS,
  tileMaskBytes,
  reducedColorSize,
  screenGiConfig,
} from './screenSpaceQuality.ts'
import { SCREEN_SPACE_BINDINGS as B } from './rayCastWgsl.ts'
import { PREV_FRAME_BINDINGS } from './prevFrameWgsl.ts'
import { HALF_RES_BINDINGS } from './halfResWgsl.ts'
import { COMPOSE_INPUT_BINDING } from './composeWgsl.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { REFLECTION_SKY_LIGHT } from '../reflections/viewLayout.ts'
import { TEMPORAL_HISTORY_BINDING } from './temporalWgsl.ts'
import { SCREEN_SPACE_VIEW_BYTES } from './screenSpaceView.ts'
import {
  SCREEN_REFLECTION_STENCIL_FORMAT,
  SCREEN_REFLECTION_STENCIL_REFERENCE,
  prevFrameReductionPipelines,
  screenDiffusePipeline,
  screenReflectionPipelines,
  screenHalfResPipeline,
  screenReflectionComposePipeline,
  screenReflectionTemporalPipeline,
  screenReflectionTilePipelines,
  screenSpaceLayouts,
} from './pipelines.ts'

const HDR = 'rgba16float' as const

/** The words of the tile buffer of arguments: the indirect draw's four, then the dispatch's three. */
const SCREEN_REFLECTION_TILE_ARGUMENT_WORDS = 7

/** What a pass of the screen-space traces reads of the frame: the view (ScreenSpaceView), the depth pyramid, the surface's targets, the
 *  vectors of the image, and the sampler of the image held. The image held (color) is the pass's own. */
export interface ScreenSpaceInputs {
  view: GPUBuffer
  depth: HizDepth
  normals: GPUTextureView
  flags: GPUTextureView
  lobes: GPUTextureView
  vectors: GPUTextureView
  sampler: GPUSampler
}

const makeTexture = (
  device: GPUDevice,
  label: string,
  w: number,
  h: number,
  format: GPUTextureFormat,
  usage: number,
  mips = 1,
) => device.createTexture({ label, size: [w, h], format, usage, mipLevelCount: mips })

/** The indirect light's targets: the last image's reduced chain, the light and its occlusion. */
const createIndirectTargets = (device: GPUDevice, width: number, height: number, ratio: 1 | 2) => {
  const [reducedWidth, reducedHeight] = reducedColorSize(width, height)
  const reduced = makeTexture(
    device,
    'Trillion3D screen space reduced colour',
    reducedWidth,
    reducedHeight,
    HDR,
    loadOnlyUsage(),
    REDUCED_COLOR_MIPS,
  )
  const diffuseSize = [ceilDiv(width, ratio), ceilDiv(height, ratio)] as const
  const levels = Array.from({ length: REDUCED_COLOR_MIPS }, (_, mip) =>
    reduced.createView({ baseMipLevel: mip, mipLevelCount: 1, dimension: '2d' }),
  )
  const diffuse = makeTexture(
    device,
    'Trillion3D screen diffuse light',
    diffuseSize[0],
    diffuseSize[1],
    HDR,
    loadOnlyUsage(),
  )
  const occlusion = makeTexture(
    device,
    'Trillion3D screen diffuse occlusion',
    diffuseSize[0],
    diffuseSize[1],
    'r32float',
    loadOnlyUsage(),
  )
  return {
    reduced,
    reducedView: reduced.createView(),
    levels,
    diffuse,
    diffuseView: diffuse.createView(),
    occlusion,
    occlusionView: occlusion.createView(),
  }
}

/** The confusion the denoiser spreads the reflections with (how far the closest ray went). */
const createConfusionTarget = (device: GPUDevice, width: number, height: number) => {
  const made = makeTexture(
    device,
    'Trillion3D screen reflection confusion',
    width,
    height,
    'r32float',
    loadOnlyUsage() | GPUTextureUsage.RENDER_ATTACHMENT,
  )
  return { texture: made, view: made.createView() }
}

/** The tile mask, the draw and dispatch arguments and the list of the tiles that trace. */
const createReflectionTileBuffers = (device: GPUDevice, tilesAcross: number, tilesDown: number) => {
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST })
  return {
    tileMask: buffer(
      'Trillion3D screen reflection tile mask',
      tileMaskBytes(tilesAcross * tilesDown),
      GPUBufferUsage.STORAGE,
    ),
    tileArguments: buffer(
      'Trillion3D screen reflection tile arguments',
      4 * SCREEN_REFLECTION_TILE_ARGUMENT_WORDS,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    ),
    tileList: buffer(
      'Trillion3D screen reflection tile list',
      4 * Math.max(1, tilesAcross * tilesDown),
      GPUBufferUsage.STORAGE,
    ),
  }
}

/** The reflections' textures: the half-resolution colour, the reflections, their two histories and, where asked, the stencil. */
const createReflectionTextures = (
  device: GPUDevice,
  width: number,
  height: number,
  withStencil: boolean,
) => {
  const texture = (label: string, w: number, h: number, format: GPUTextureFormat, usage: number) =>
    makeTexture(device, label, w, h, format, usage)
  const halfRes = texture(
    'Trillion3D screen space half resolution colour',
    Math.max(1, ceilDiv(width, 2)),
    Math.max(1, ceilDiv(height, 2)),
    HDR,
    loadOnlyUsage(),
  )
  const reflection = texture(
    'Trillion3D screen reflections',
    width,
    height,
    HDR,
    loadOnlyUsage() | GPUTextureUsage.RENDER_ATTACHMENT,
  )
  const history = [0, 1].map((turn) =>
    texture(`Trillion3D screen reflection history ${turn}`, width, height, HDR, loadOnlyUsage()),
  )
  const stencil = withStencil
    ? texture(
        'Trillion3D screen reflections stencil',
        width,
        height,
        SCREEN_REFLECTION_STENCIL_FORMAT,
        GPUTextureUsage.RENDER_ATTACHMENT,
      )
    : undefined
  return { halfRes, reflection, history, stencil }
}

/** The targets of the screen-space traces for an image of width × height, ratio (1 or 2) pixels per texel of the indirect light. */
export function createScreenSpaceTargets(
  device: GPUDevice,
  width: number,
  height: number,
  ratio: 1 | 2,
  withStencil: boolean,
) {
  const tilesAcross = ceilDiv(width, SCREEN_SPACE_GROUP_SIDE)
  const tilesDown = ceilDiv(height, SCREEN_SPACE_GROUP_SIDE)
  const groups = new Map<string, { deps: readonly unknown[]; group: GPUBindGroup }>()
  /** The indirect light's targets, made at the first ask. */
  let indirect: ReturnType<typeof createIndirectTargets> | undefined
  const indirectTargets = () => (indirect ??= createIndirectTargets(device, width, height, ratio))
  /** The confusion target, made at the first ask. */
  let confusion: ReturnType<typeof createConfusionTarget> | undefined
  const confusionTarget = () => (confusion ??= createConfusionTarget(device, width, height))
  const { halfRes, reflection, history, stencil } = createReflectionTextures(
    device,
    width,
    height,
    withStencil,
  )
  const tiles = createReflectionTileBuffers(device, tilesAcross, tilesDown)
  return {
    width,
    height,
    ratio,
    reflection,
    reflectionView: reflection.createView(),
    stencilView: stencil?.createView(),
    halfRes,
    halfResView: halfRes.createView(),
    confusionTarget,
    indirectTargets,
    reducedLevel: (mip: number) => indirectTargets().levels[mip],
    groups,
    history,
    historyViews: history.map((t) => t.createView()),
    tilesAcross,
    tilesDown,
    ...tiles,
    destroy() {
      for (const t of [reflection, halfRes, stencil, ...history]) t?.destroy()
      confusion?.texture.destroy()
      indirect?.reduced.destroy()
      indirect?.diffuse.destroy()
      indirect?.occlusion.destroy()
      tiles.tileMask.destroy()
      tiles.tileArguments.destroy()
      tiles.tileList.destroy()
    },
  }
}
export type ScreenSpaceTargets = ReturnType<typeof createScreenSpaceTargets>

/** The uniform buffer of a view. */
export const createScreenSpaceViewBuffer = (device: GPUDevice) =>
  device.createBuffer({
    label: 'Trillion3D screen space view',
    size: SCREEN_SPACE_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

/** The entries of a pass's group that are the inputs (inputEntries), color the image its rays read. */
export const inputGroupEntries = (
  inputs: ScreenSpaceInputs,
  color: GPUTextureView,
): GPUBindGroupEntry[] => [
  { binding: B.view, resource: { buffer: inputs.view } },
  ...hizDepthBindEntries(B.hiz, inputs.depth),
  { binding: B.normals, resource: inputs.normals },
  { binding: B.flags, resource: inputs.flags },
  { binding: B.lobes, resource: inputs.lobes },
  { binding: B.color, resource: color },
  { binding: B.colorSampler, resource: inputs.sampler },
  { binding: B.vectors, resource: inputs.vectors },
]

/** What keeps bind groups by name: the targets of a pass family. */
export interface GroupCache {
  groups: Map<string, { deps: readonly unknown[]; group: GPUBindGroup }>
}

/** The bind group `name` of `targets` over `layout`: kept while every resource it binds (`deps`) is the one it was made with, made from
 *  `entries` otherwise. The inputs are the same views from one image to the next unless the view is resized or its history trades places. */
export function groupFor(
  device: GPUDevice,
  targets: GroupCache,
  name: string,
  layout: GPUBindGroupLayout,
  deps: readonly unknown[],
  entries: () => GPUBindGroupEntry[],
) {
  const held = targets.groups.get(name)
  if (held && held.deps.length === deps.length && held.deps.every((dep, i) => dep === deps[i]))
    return held.group
  const group = device.createBindGroup({ layout, entries: entries() })
  targets.groups.set(name, { deps, group })
  return group
}

/** What a pass's group depends on besides its own outputs: the inputs and the image its rays read. */
export const inputDeps = (inputs: ScreenSpaceInputs, color: GPUTextureView) => [
  inputs.view,
  ...inputs.depth.resources,
  inputs.normals,
  inputs.flags,
  inputs.lobes,
  inputs.vectors,
  inputs.sampler,
  color,
]

/**
 * THE LAST LIT IMAGE REDUCED (two compute passes; reduceFirst over the view's pixels, reduceLower over every eighth): previous is
 * the image held and previousDepth the depth it kept; the chain lands in targets.reduced. Nothing while a stage is compiling.
 */
export function encodeReducedColor(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  inputs: ScreenSpaceInputs,
  previous: GPUTextureView,
  previousDepth: GPUTextureView,
) {
  const stages = prevFrameReductionPipelines(device)
  const layouts = screenSpaceLayouts(device)
  const first = groupFor(
    device,
    targets,
    'reduceFirst',
    layouts.reduceFirst,
    [...inputDeps(inputs, previous), previousDepth],
    () => [
      ...inputGroupEntries(inputs, previous),
      { binding: PREV_FRAME_BINDINGS.prevDepth, resource: previousDepth },
      { binding: B.out, resource: targets.reducedLevel(0) },
      { binding: B.outSecond, resource: targets.reducedLevel(1) },
    ],
  )
  const lower = groupFor(
    device,
    targets,
    'reduceLower',
    layouts.reduceLower,
    inputDeps(inputs, previous),
    () => [
      ...inputGroupEntries(inputs, previous),
      { binding: PREV_FRAME_BINDINGS.higher, resource: targets.reducedLevel(1) },
      { binding: B.out, resource: targets.reducedLevel(2) },
      { binding: B.outSecond, resource: targets.reducedLevel(3) },
      { binding: PREV_FRAME_BINDINGS.outThird, resource: targets.reducedLevel(4) },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen space reduction' })
  dispatchOn(
    pass,
    stages.first,
    first,
    ceilDiv(targets.width, SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(targets.height, SCREEN_SPACE_GROUP_SIDE),
  )
  pass.end()
  const second = encoder.beginComputePass({ label: 'Trillion3D screen space reduction lower' })
  const divisor = SCREEN_SPACE_GROUP_THREADS
  dispatchOn(
    second,
    stages.lower,
    lower,
    ceilDiv(targets.width, divisor),
    ceilDiv(targets.height, divisor),
  )
  second.end()
}

/** The indirect diffuse light (one compute pass) at the quality level, its rays reading the reduced chain: the light in targets.diffuse,
 *  the occlusion in targets.occlusion. */
export function encodeScreenDiffuse(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  inputs: ScreenSpaceInputs,
  level: number,
) {
  const { tileX, tileY } = screenGiConfig(level)
  const group = groupFor(
    device,
    targets,
    'diffuse',
    screenSpaceLayouts(device).diffuse,
    inputDeps(inputs, targets.indirectTargets().reducedView),
    () => [
      ...inputGroupEntries(inputs, targets.indirectTargets().reducedView),
      { binding: B.out, resource: targets.indirectTargets().diffuseView },
      { binding: B.outSecond, resource: targets.indirectTargets().occlusionView },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen space diffuse' })
  dispatchOn(
    pass,
    screenDiffusePipeline(device, level),
    group,
    ceilDiv(ceilDiv(targets.width, targets.ratio), tileX),
    ceilDiv(ceilDiv(targets.height, targets.ratio), tileY),
  )
  pass.end()
}

/** How the reflections run: their level, whether they run over the tiles (tiles, with the tiles tinted when show), behind a stencil
 *  (stencil) or as a compute pass (compute). The tiles come first, then the stencil: a compute pass runs where neither is asked. */
export interface ScreenReflectionPlan {
  quality: ScreenReflectionQuality
  tiles: boolean
  show: boolean
  stencil: boolean
  compute: boolean
  /** Whether the trace also writes how far its rays went (`targets.confusionTarget()`), for the denoiser. */
  denoise: boolean
}

/** What the passes of the reflections share: the device and encoder, the targets and inputs, the image the rays read, the plan and the inputs' dependencies. */
interface ReflectionPassContext {
  device: GPUDevice
  encoder: GPUCommandEncoder
  targets: ScreenSpaceTargets
  inputs: ScreenSpaceInputs
  color: GPUTextureView
  plan: ScreenReflectionPlan
  deps: readonly unknown[]
}

/** The tile lists: a clear of the mask and of the arguments, the mark pass, the list pass. */
function encodeReflectionTiles(c: ReflectionPassContext) {
  const { device, encoder, targets, inputs, color } = c
  const stages = screenReflectionTilePipelines(device)
  encoder.clearBuffer(targets.tileMask)
  encoder.clearBuffer(targets.tileArguments)
  const tileGroup = groupFor(
    device,
    targets,
    'tiles',
    screenSpaceLayouts(device).tiles,
    c.deps,
    () => [
      ...inputGroupEntries(inputs, color),
      { binding: B.out, resource: { buffer: targets.tileMask } },
      { binding: B.outSecond, resource: { buffer: targets.tileArguments } },
      { binding: B.list, resource: { buffer: targets.tileList } },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen reflection tiles' })
  dispatchOn(pass, stages.mark, tileGroup, targets.tilesAcross, targets.tilesDown)
  pass.end()
  const lists = encoder.beginComputePass({ label: 'Trillion3D screen reflection tile lists' })
  dispatchOn(
    lists,
    stages.list,
    tileGroup,
    ceilDiv(targets.tilesAcross, SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(targets.tilesDown, SCREEN_SPACE_GROUP_SIDE),
  )
  lists.end()
}

/** The depth-stencil attachment of a pass over the stencil (undefined where there is none). */
const stencilAttachment = (stencilView: GPUTextureView | undefined, load: GPULoadOp) =>
  stencilView && {
    depthStencilAttachment: {
      view: stencilView,
      stencilClearValue: 0,
      stencilLoadOp: load,
      stencilStoreOp: 'store' as const,
    },
  }

/** The draw pipeline of the reflections: over the tiles (shown or not), or over the whole view, behind the stencil or not. */
const reflectionDraw = (
  pipelines: ReturnType<typeof screenReflectionPipelines>,
  tiled: boolean,
  shown: boolean,
  stenciled: boolean,
) =>
  tiled
    ? shown
      ? pipelines.tiledShown
      : pipelines.tiled
    : stenciled
      ? pipelines.fullscreenStenciled
      : pipelines.fullscreen

/** The draws of the reflections: over the whole view (behind the stencil it marks first, where asked) or over the tiles by an indirect draw. */
function encodeReflectionDraws(
  c: ReflectionPassContext,
  pipelines: ReturnType<typeof screenReflectionPipelines>,
  confusion: GPUTextureView | undefined,
  tiled: boolean,
) {
  const { device, encoder, targets, inputs, color, plan } = c
  // The draws bind no storage texture: their targets are attached.
  const drawGroup = groupFor(
    device,
    targets,
    'reflectionDraw',
    screenSpaceLayouts(device).reflectionDraw,
    c.deps,
    () => [
      ...inputGroupEntries(inputs, color),
      { binding: B.list, resource: { buffer: targets.tileList } },
    ],
  )
  const stenciled = plan.stencil && !tiled && targets.stencilView !== undefined
  const draw = reflectionDraw(pipelines, tiled, plan.show, stenciled)
  const stencilPass = stenciled ? pipelines.stencil.get() : undefined
  const pipeline = draw.get()
  if (!pipeline || (stenciled && !stencilPass)) return
  const colorAttachments = (loadOp: GPULoadOp): GPURenderPassColorAttachment[] => [
    { view: targets.reflectionView, loadOp, clearValue: [0, 0, 0, 0], storeOp: 'store' },
    // No ray cast is a confusion of -1.
    ...(confusion
      ? [{ view: confusion, loadOp, clearValue: [-1, 0, 0, 0], storeOp: 'store' as const }]
      : []),
  ]
  if (stenciled && stencilPass) {
    const marking = encoder.beginRenderPass({
      label: 'Trillion3D screen reflections stencil',
      colorAttachments: colorAttachments('clear'),
      ...stencilAttachment(targets.stencilView, 'clear'),
    })
    marking.setPipeline(stencilPass)
    marking.setBindGroup(0, drawGroup)
    marking.setStencilReference(SCREEN_REFLECTION_STENCIL_REFERENCE)
    marking.draw(3)
    marking.end()
  }
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D screen reflections',
    colorAttachments: colorAttachments(stenciled ? 'load' : 'clear'),
    ...(stenciled && stencilAttachment(targets.stencilView, 'load')),
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, drawGroup)
  if (stenciled) pass.setStencilReference(SCREEN_REFLECTION_STENCIL_REFERENCE)
  if (tiled) pass.drawIndirect(targets.tileArguments, 0)
  else pass.draw(3)
  pass.end()
}

/**
 * THE SCREEN REFLECTIONS: the tile lists first when the plan runs over tiles (a clear, the mark pass, the list pass), then the trace into
 * targets.reflection — a compute pass, or a draw over the whole view, behind the stencil it marks first, or over the tiles by an
 * indirect draw. color is the image the rays read (the image held, or this image's half-resolution twin).
 */
export function encodeScreenReflections(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  inputs: ScreenSpaceInputs,
  color: GPUTextureView,
  plan: ScreenReflectionPlan,
) {
  const layouts = screenSpaceLayouts(device)
  const pipelines = screenReflectionPipelines(device, plan.quality, plan.denoise)
  const confusion = plan.denoise ? targets.confusionTarget().view : undefined
  const deps = inputDeps(inputs, color)
  const context: ReflectionPassContext = { device, encoder, targets, inputs, color, plan, deps }
  const group = groupFor(
    device,
    targets,
    plan.denoise ? 'reflectionDenoised' : 'reflection',
    plan.denoise ? layouts.reflectionDenoised : layouts.reflection,
    confusion ? [...deps, confusion] : deps,
    () => [
      ...inputGroupEntries(inputs, color),
      { binding: B.out, resource: targets.reflectionView },
      ...(confusion ? [{ binding: B.outSecond, resource: confusion }] : []),
      { binding: B.list, resource: { buffer: targets.tileList } },
    ],
  )
  const tiled = plan.tiles
  if (tiled) encodeReflectionTiles(context)
  if (plan.compute && !tiled && !plan.stencil) {
    const pass = encoder.beginComputePass({ label: 'Trillion3D screen reflections' })
    dispatchOn(
      pass,
      pipelines.compute,
      group,
      ceilDiv(targets.width, SCREEN_SPACE_GROUP_SIDE),
      ceilDiv(targets.height, SCREEN_SPACE_GROUP_SIDE),
    )
    pass.end()
    return
  }
  encodeReflectionDraws(context, pipelines, confusion, tiled)
}

/**
 * THE TEMPORAL FILTER OF THE SCREEN REFLECTIONS (one compute pass): the new reflections (`targets.reflection`) are blended with the history of
 * the image before (`turn` is the image's rank: the two history textures take turns being read and written) and the result, in
 * `targets.historyViews[turn % 2]`, is the filtered reflection the composition reads and the next image's history.
 */
export function encodeScreenReflectionTemporal(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  inputs: ScreenSpaceInputs,
  turn: number,
) {
  const read = targets.historyViews[(turn + 1) % 2]
  const write = targets.historyViews[turn % 2]
  const group = groupFor(
    device,
    targets,
    `temporal${turn % 2}`,
    screenSpaceLayouts(device).temporal,
    [...inputDeps(inputs, targets.reflectionView), read, write],
    () => [
      ...inputGroupEntries(inputs, targets.reflectionView),
      { binding: TEMPORAL_HISTORY_BINDING, resource: read },
      { binding: B.out, resource: write },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen reflection temporal' })
  dispatchOn(
    pass,
    screenReflectionTemporalPipeline(device),
    group,
    ceilDiv(targets.width, SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(targets.height, SCREEN_SPACE_GROUP_SIDE),
  )
  pass.end()
}

/**
 * THE REFLECTIONS COMPOSED INTO THE TARGET the opaque resolve reads (one compute pass): the traced image `traced` (the reflections, or the
 * temporal filter's result) plus, where the rays did not hit, the sky light's radiance along the reflected direction (`sky`), written in layer 0
 * of `target`, a view of the whole 2d-array.
 */
export function encodeScreenReflectionCompose(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  inputs: ScreenSpaceInputs,
  traced: GPUTextureView,
  target: GPUTextureView,
  sky: SkyLightReadSet,
) {
  const layouts = screenSpaceLayouts(device)
  const group = groupFor(
    device,
    targets,
    'compose',
    layouts.compose,
    [...inputDeps(inputs, targets.reflectionView), traced, target],
    () => [
      ...inputGroupEntries(inputs, targets.reflectionView),
      { binding: COMPOSE_INPUT_BINDING, resource: traced },
      { binding: B.out, resource: target },
    ],
  )
  const skyGroup = groupFor(
    device,
    targets,
    'sky',
    layouts.sky,
    [sky.cube, sky.sampler, sky.harmonics, sky.params],
    () => skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen reflection compose' })
  const pipeline = screenReflectionComposePipeline(device).get()
  if (pipeline) {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.setBindGroup(REFLECTION_SKY_LIGHT.group, skyGroup)
    pass.dispatchWorkgroups(
      ceilDiv(targets.width, SCREEN_SPACE_GROUP_SIDE),
      ceilDiv(targets.height, SCREEN_SPACE_GROUP_SIDE),
    )
  }
  pass.end()
}

/** The last lit image `source` halved (one compute pass), into `targets.halfResView`: what the reflections' rays read when `screenReflectionHalfResColor` is on. */
export function encodeHalfResColor(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: ScreenSpaceTargets,
  source: GPUTextureView,
) {
  const group = groupFor(
    device,
    targets,
    'halfRes',
    screenSpaceLayouts(device).halfRes,
    [source],
    () => [
      { binding: HALF_RES_BINDINGS.source, resource: source },
      { binding: HALF_RES_BINDINGS.result, resource: targets.halfResView },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen space half resolution' })
  dispatchOn(
    pass,
    screenHalfResPipeline(device),
    group,
    ceilDiv(ceilDiv(targets.width, 2), SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(ceilDiv(targets.height, 2), SCREEN_SPACE_GROUP_SIDE),
  )
  pass.end()
}
