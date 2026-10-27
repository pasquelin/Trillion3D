import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { CapturePage } from '../../../../sdk-core/src/lighting/surfaceCache/captures.ts'
import { dispatchGrid, groupWidth } from '../../gpu/dispatch/grid.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { SHADING_ENERGY_ALONG_NORMAL } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { SurfaceAtlases } from './atlases.ts'
import { createKernel, type Kernel as CacheKernel } from './kernel.ts'
import { copyBlockPages, createBlockClear } from './compress.ts'
import { ENCODE_ENTRIES, ENCODE_WGSL, TILES_PER_GROUP } from './compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  copyEntryPoints,
  LIGHTS_WGSL,
  RESAMPLE_COMPRESSED_WGSL,
  RESAMPLE_LIGHTING_COMPRESSED_WGSL,
  RESAMPLE_LIGHTING_WGSL,
  RESAMPLE_WGSL,
  RESOLVE_WGSL,
} from './copyWgsl.ts'
import {
  atlasFormats,
  CAPTURE_FORMATS,
  CAPTURE_PARAMS,
  PAGE_ENTRY_WORDS,
  PAGE_FLAGS,
  TILE,
} from './layout.ts'
import { surfaceCacheReadLayoutEntries } from './sampleWgsl.ts'

/**
 * THE CAPTURE'S KERNELS ON THE GPU (`copyWgsl.ts`): the pipelines of the five — six for a compressed
 * atlas —, and what an image gives them — the pages it captures, laid as a list of page entries and
 * the lists of the tiles of those pages each kernel works over, written to the buffers they read. The
 * kernels run in two stages, in the order the capture needs. Before the image's tables go up
 * (`resample`), over the tables as they were: the pages that copy another card's texels filled from
 * the atlas, and the light each page's card held carried into the capture atlas. Then, after the raster
 * and the shading (`encode`): the shaded surfaces resolved to the cards' encodings, every page copied
 * into the atlas — its depth alone, for a compressed atlas, whose other layers are blocks the
 * encoders (`compressWgsl.ts`) write to a staging buffer, which `copyBlocks` puts in the atlas after
 * the pass — and given the light it starts with. Each stage lays its pages in buffers of its own: both
 * are written before the image's commands run.
 */

const ro = 'read-only-storage' as const

/** The kernels' names. `encode` is the compressed atlas's alone. */
type Kernel = 'resample' | 'resampleLighting' | 'resolve' | 'copy' | 'encode' | 'lights'

/** The stages: the kernels that run before the tables go up, and those after the shading. */
type Stage = 'resample' | 'capture'
/** The tiles a kernel works over: those of the pages drawn, of the pages that copy, of every page. */
type Tiles = 'draw' | 'copy' | 'all'

/** The stage of each kernel and the tiles it works over. */
const KERNELS: Record<Kernel, { readonly stage: Stage; readonly tiles: Tiles }> = {
  resample: { stage: 'resample', tiles: 'copy' },
  resampleLighting: { stage: 'resample', tiles: 'all' },
  resolve: { stage: 'capture', tiles: 'draw' },
  copy: { stage: 'capture', tiles: 'all' },
  encode: { stage: 'capture', tiles: 'all' },
  lights: { stage: 'capture', tiles: 'all' },
}

/** The tile lists a stage lays, in order: the ones its kernels work over (`KERNELS`). */
const LISTS_OF: Record<Stage, readonly Tiles[]> = {
  resample: ['copy', 'all'],
  capture: ['draw', 'all'],
}

/** A kernel's program and its entry points. */
interface Program {
  readonly code: string
  readonly entries: readonly string[]
}

/** The program of each kernel of an atlas `compressed` or not, in the order they run: the encoders of
 *  the blocks, three entry points — one for each layer in blocks —, are the compressed atlas's alone. */
function programsOf(compressed: boolean) {
  const kernels: Partial<Record<Kernel, Program>> = {
    resample: {
      code: compressed ? RESAMPLE_COMPRESSED_WGSL : RESAMPLE_WGSL,
      entries: ['resamplePages'],
    },
    resampleLighting: {
      code: compressed ? RESAMPLE_LIGHTING_COMPRESSED_WGSL : RESAMPLE_LIGHTING_WGSL,
      entries: ['resampleLightingPages'],
    },
    resolve: { code: RESOLVE_WGSL, entries: ['resolvePages'] },
    copy: {
      code: compressed ? COPY_COMPRESSED_WGSL : COPY_WGSL,
      entries: copyEntryPoints(compressed),
    },
  }
  if (compressed) kernels.encode = { code: ENCODE_WGSL, entries: ENCODE_ENTRIES }
  kernels.lights = { code: LIGHTS_WGSL, entries: ['lightsPages'] }
  return kernels
}

const write = computeStorageTextureEntry

/** The formats of the atlas's layers, for an atlas `compressed` or not. */
type AtlasFormats = ReturnType<typeof atlasFormats>

/** The capture atlas's layers, read: the copy's and the encoders' bindings 3 to 6. */
const captureLayerEntries = () => [
  computeTextureEntry(3, 'float'),
  computeTextureEntry(4, 'float'),
  computeTextureEntry(5, 'uint'),
  computeTextureEntry(6, 'unfilterable-float'),
]

/** The resolve's entries: the cards' encodings from the shaded surfaces, written to the capture atlas. */
const resolveEntries = () => [
  computeBufferEntry(3, ro),
  computeTextureEntry(4, 'uint'),
  computeTextureEntry(5, 'float', '2d-array'),
  write(6, CAPTURE_FORMATS.albedo),
  write(7, CAPTURE_FORMATS.normal),
  write(8, CAPTURE_FORMATS.emissive),
  computeTextureEntry(9, 'uint', '2d-array'),
  computeTextureEntry(10, 'uint'),
  computeBufferEntry(11, ro),
]

/** The resample's entries: the pages of the atlas read, the capture atlas's layers written. */
const resampleEntries = (compressed: boolean) => [
  ...surfaceCacheReadLayoutEntries(3, { feedback: false, compressed }),
  write(11, CAPTURE_FORMATS.albedo),
  write(12, CAPTURE_FORMATS.normal),
  write(13, CAPTURE_FORMATS.emissive),
  write(14, CAPTURE_FORMATS.depth),
]

/** The light-carrying resample's entries: the pages read, the capture atlas's light written. */
const resampleLightingEntries = (compressed: boolean) => [
  ...surfaceCacheReadLayoutEntries(3, { feedback: false, compressed }),
  computeTextureEntry(11, 'uint'),
  write(12, CAPTURE_FORMATS.direct),
  write(13, CAPTURE_FORMATS.indirect),
  write(14, CAPTURE_FORMATS.frames),
  computeBufferEntry(15, ro),
  computeBufferEntry(16, 'storage'),
]

/** The copy's entries: the capture atlas's layers read, the atlas's written (its depth alone where compressed). */
const copyEntries = (formats: AtlasFormats, compressed: boolean) => [
  ...captureLayerEntries(),
  write(7, formats.depth),
  ...(compressed
    ? []
    : [write(8, formats.albedo), write(9, formats.normal), write(10, formats.emissive)]),
]

/** The lights' entries: the capture atlas's light read, the atlas's light written. */
const lightsEntries = (formats: AtlasFormats) => [
  computeTextureEntry(3, 'float'),
  computeTextureEntry(4, 'uint'),
  computeTextureEntry(5, 'uint'),
  computeTextureEntry(6, 'uint'),
  computeTextureEntry(7, 'uint'),
  write(8, formats.direct),
  write(9, formats.indirect),
  write(10, formats.final),
  write(11, formats.frames),
  computeBufferEntry(12, ro),
  computeBufferEntry(13, ro),
  computeBufferEntry(14, 'storage'),
]

/** The layout entries of the kernels of an atlas `compressed` or not, past their parameters (binding 0, the
 *  kernel's own): the pages' entries and the tile lists every kernel reads, then what it names. */
function layoutEntriesOf(compressed: boolean): Record<Kernel, GPUBindGroupLayoutEntry[]> {
  const formats = atlasFormats(compressed)
  const lists = [computeBufferEntry(1, ro), computeBufferEntry(2, ro)]
  const layouts: Record<Kernel, GPUBindGroupLayoutEntry[]> = {
    resolve: resolveEntries(),
    resample: resampleEntries(compressed),
    resampleLighting: resampleLightingEntries(compressed),
    copy: copyEntries(formats, compressed),
    encode: [...captureLayerEntries(), computeBufferEntry(7, 'storage')],
    lights: lightsEntries(formats),
  }
  for (const entries of Object.values(layouts)) entries.unshift(...lists)
  return layouts
}

/** What the kernels that run before the tables go up read beside the pages: the atlases and the tables as
 *  they were before the image. */
interface ResampleInputs {
  readonly atlases: SurfaceAtlases
  readonly tables: GPUBuffer
}

/** What the kernels after the shading read beside the pages: the atlases, the tables as they are, the
 *  capture's shaded surfaces. */
interface CaptureInputs extends ResampleInputs {
  /** The colours of the surfaces the classes shaded (`CardShading.surfaces`). */
  readonly colours: GPUTextureView
  /** The words of the surfaces the classes shaded: their flags, which hold the specular. */
  readonly words: GPUTextureView
  /** Their lobes: the clear coat's weight and roughness, where the flags say a surface has a lobe. */
  readonly lobes: GPUTextureView
}

/** What the kernels run with in an image. */
export interface CaptureSettings {
  /** Whether every page dilates by a texel (`surfaceCacheDilationMode` 2). */
  readonly dilate: boolean
  /** Whether the light the pages' cards held is carried into the pages (`surfaceCacheResampleLighting`);
   *  without it a captured page starts with no light. */
  readonly resample: boolean
  /** Whether the radiosity is on (`surfaceCacheRadiosity`): its light and accumulation are carried too. */
  readonly radiosity: boolean
  /** The number the light is kept multiplied by. */
  readonly preExposure: number
}

/** The capture atlas's layers read (`captureLayerEntries`): the copy's and the encoders' resources from binding 3. */
const captureLayers = ({ capture: c }: SurfaceAtlases) => [c.albedo, c.normal, c.emissive, c.depth]

/** The tables and the atlas's pages the two resamples read, their resources from binding 3. */
const resampleReads = ({ physical: p }: SurfaceAtlases, tables: GPUBuffer) => [
  { buffer: tables },
  p.depth,
  p.albedo,
  p.normal,
  p.emissive,
  p.direct,
  p.indirect,
  p.final,
]

/** The resources of the resolve: the tables, the capture's ids and shaded surfaces, its layers but the depth, the words, the
 *  lobes and the energy table's column along the normal. */
const resolveReads = (
  { capture: c }: SurfaceAtlases,
  tables: GPUBuffer,
  shaded: Pick<CaptureInputs, 'colours' | 'words' | 'lobes'>,
  energy: GPUBuffer,
) => [
  { buffer: tables },
  c.ids,
  shaded.colours,
  c.albedo,
  c.normal,
  c.emissive,
  shaded.words,
  shaded.lobes,
  { buffer: energy },
]

/** The resources of the resample: the pages' reads, then the capture's layers. */
const resampleCaptureReads = (atlases: SurfaceAtlases, tables: GPUBuffer) => {
  const { capture: c } = atlases
  return [...resampleReads(atlases, tables), c.albedo, c.normal, c.emissive, c.depth]
}

/** The resources of the resample that carries the light: the pages' reads, the frames, the capture's light and
 *  frames, the two factor tables. */
const resampleLightingReads = (atlases: SurfaceAtlases, tables: GPUBuffer) => {
  const { physical: p, capture: c } = atlases
  return [
    ...resampleReads(atlases, tables),
    p.frames,
    c.direct,
    c.indirect,
    c.frames,
    { buffer: atlases.factors },
    { buffer: atlases.captureFactors },
  ]
}

/** The resources of the copy: the capture's layers, the pages' depth, and the colour pages when the atlas is not compressed. */
const copyReads = (atlases: SurfaceAtlases) => {
  const { physical: p } = atlases
  return [
    ...captureLayers(atlases),
    p.depth,
    ...(atlases.compressed ? [] : [p.albedo, p.normal, p.emissive]),
  ]
}

/** The resources of the lights: the capture's colours and light, the pages' light, the tables and the factors. */
const lightsReads = (atlases: SurfaceAtlases, tables: GPUBuffer) => {
  const { physical: p, capture: c } = atlases
  return [
    c.albedo,
    c.emissive,
    c.direct,
    c.indirect,
    c.frames,
    p.direct,
    p.indirect,
    p.final,
    p.frames,
    { buffer: tables },
    { buffer: atlases.captureFactors },
    { buffer: atlases.factors },
  ]
}

/** The bind group entries of `kernel` after its parameters, the pages' entries and the tile lists: the resources it names,
 *  numbered as its layout lists them (`layoutEntriesOf`) from binding 3. `shaded` are the shaded surfaces of the capture's
 *  kernels, which the resolve alone reads. */
function bindingsOf(
  kernel: Kernel,
  atlases: SurfaceAtlases,
  tables: GPUBuffer,
  shaded: Pick<CaptureInputs, 'colours' | 'words' | 'lobes'> | undefined,
  energy: GPUBuffer,
) {
  switch (kernel) {
    case 'resolve':
      return sequentialEntries(resolveReads(atlases, tables, shaded!, energy), 3)
    case 'resample':
      return sequentialEntries(resampleCaptureReads(atlases, tables), 3)
    case 'resampleLighting':
      return sequentialEntries(resampleLightingReads(atlases, tables), 3)
    case 'copy':
      return sequentialEntries(copyReads(atlases), 3)
    case 'encode':
      return sequentialEntries([...captureLayers(atlases), { buffer: atlases.blocks!.staging }], 3)
    case 'lights':
      return sequentialEntries(lightsReads(atlases, tables), 3)
  }
}

/** The buffers a stage lays its pages in. */
interface StageLists {
  pageBuffer: GPUBuffer | undefined
  tileBuffer: GPUBuffer | undefined
}

/** What the capture's kernels keep between two images. */
interface CaptureContext {
  readonly device: GPUDevice
  readonly programs: Partial<Record<Kernel, Program>>
  readonly order: Kernel[]
  readonly kernels: Record<Kernel, CacheKernel<string>>
  readonly params: Record<Kernel, GPUBuffer>
  /** The energy table's column a view along the normal reads (`SHADING_ENERGY_ALONG_NORMAL`), which the resolve binds. */
  readonly energy: GPUBuffer
  readonly width: number
  readonly paramWords: Uint32Array<ArrayBuffer>
  readonly paramFloats: Float32Array
  /** What the groups name, in the order `Kernel.group` compares them. */
  readonly named: unknown[]
  readonly lists: Record<Stage, StageLists>
  /** The pages of the last `encode` whose blocks `copyBlocks` copies into the atlas. */
  encoded: readonly CapturePage[]
}

/** The kernels' pipelines, one for each of `order`. */
function pipelinesOf(
  device: GPUDevice,
  programs: Partial<Record<Kernel, Program>>,
  order: Kernel[],
  compressed: boolean,
) {
  const layoutEntries = layoutEntriesOf(compressed)
  return Object.fromEntries(
    order.map((kernel) => [
      kernel,
      createKernel(
        device,
        kernel,
        programs[kernel]!.code,
        programs[kernel]!.entries,
        layoutEntries[kernel],
        { parameterBytes: CAPTURE_PARAMS.words * 4 },
      ),
    ]),
  ) as Record<Kernel, CacheKernel<string>>
}

/** The parameter buffer of each of `order`. */
function paramBuffersOf(device: GPUDevice, order: Kernel[]) {
  return Object.fromEntries(
    order.map((kernel) => [
      kernel,
      device.createBuffer({
        label: `Trillion3D surface cache ${kernel} parameters`,
        size: CAPTURE_PARAMS.words * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    ]),
  ) as Record<Kernel, GPUBuffer>
}

/** The page entries of `pages` and the tiles of `lists`, laid one list after the other: the tiles and where
 *  each list begins and how many it holds. */
function pageEntriesOf(pages: readonly CapturePage[], dilate: boolean, lists: readonly Tiles[]) {
  const entryWords = new Uint32Array(Math.max(1, pages.length) * PAGE_ENTRY_WORDS)
  const floats = new Float32Array(entryWords.buffer)
  const tilesOf = (page: CapturePage) =>
    ceilDiv(page.captureRect.maxX - page.captureRect.minX, TILE) *
    ceilDiv(page.captureRect.maxY - page.captureRect.minY, TILE)
  const counts: Record<Tiles, number> = { draw: 0, copy: 0, all: 0 }
  for (const page of pages) {
    counts[page.copyCard >= 0 ? 'copy' : 'draw'] += tilesOf(page)
    counts.all += tilesOf(page)
  }
  const bases: Record<Tiles, number> = { draw: 0, copy: 0, all: 0 }
  let total = 0
  for (const list of lists) {
    bases[list] = total
    total += counts[list]
  }
  const tiles = new Uint32Array(total)
  const next = { ...bases }
  pages.forEach((page, at) => {
    const base = at * PAGE_ENTRY_WORDS
    const { captureRect: c, atlasRect: a, uv } = page
    const copy = page.copyCard >= 0
    entryWords[base] = c.minX
    entryWords[base + 1] = c.minY
    entryWords[base + 2] = c.maxX
    entryWords[base + 3] = c.maxY
    entryWords[base + 4] = a.minX
    entryWords[base + 5] = a.minY
    entryWords[base + 6] = page.card
    entryWords[base + 7] =
      (copy ? PAGE_FLAGS.copy : 0) |
      (page.axisXFlipped ? PAGE_FLAGS.flipped : 0) |
      (dilate && !copy ? PAGE_FLAGS.dilate : 0) |
      (page.resampleLighting ? PAGE_FLAGS.resampleLighting : 0)
    floats.set(uv, base + 8)
    entryWords[base + 12] = Math.max(page.copyCard, 0)
    const own: Tiles = copy ? 'copy' : 'draw'
    const across = ceilDiv(c.maxX - c.minX, TILE),
      down = ceilDiv(c.maxY - c.minY, TILE)
    for (let ty = 0; ty < down; ty++)
      for (let tx = 0; tx < across; tx++) {
        const tile = tx | (ty << 4) | (at << 8)
        if (lists.includes(own)) tiles[next[own]++] = tile
        if (lists.includes('all')) tiles[next.all++] = tile
      }
  })
  return { entryWords, tiles, counts, bases }
}

/** Writes the entries of `pages` and the tile lists of `stage` into the stage's buffers; the buffers grow
 *  with them. */
function lay(ctx: CaptureContext, stage: Stage, pages: readonly CapturePage[], dilate: boolean) {
  const { device } = ctx
  const held = ctx.lists[stage]
  const { entryWords, tiles, counts, bases } = pageEntriesOf(pages, dilate, LISTS_OF[stage])
  const entries = pages.length
  held.pageBuffer = sizedBuffer(
    device,
    held.pageBuffer,
    Math.max(64, entries) * PAGE_ENTRY_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    `Trillion3D surface cache ${stage} pages`,
  )
  held.tileBuffer = sizedBuffer(
    device,
    held.tileBuffer,
    Math.max(1024, tiles.length) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    `Trillion3D surface cache ${stage} tiles`,
  )
  device.queue.writeBuffer(held.pageBuffer, 0, entryWords)
  if (tiles.length) device.queue.writeBuffer(held.tileBuffer, 0, tiles)
  return { pages: entries, counts, bases }
}

/** The bind group of `kernel`, made again when a resource it names moved. */
function groupOf(ctx: CaptureContext, kernel: Kernel, inputs: ResampleInputs | CaptureInputs) {
  const { named } = ctx
  const held = ctx.lists[KERNELS[kernel].stage]
  named[0] = held.pageBuffer
  named[1] = held.tileBuffer
  named[2] = inputs.atlases
  named[3] = inputs.tables
  const shaded = 'colours' in inputs ? inputs : undefined
  named[4] = shaded?.colours
  named[5] = shaded?.words
  named[6] = shaded?.lobes
  return ctx.kernels[kernel].group(named, () => [
    { binding: 0, resource: { buffer: ctx.params[kernel] } },
    { binding: 1, resource: { buffer: held.pageBuffer! } },
    { binding: 2, resource: { buffer: held.tileBuffer! } },
    ...bindingsOf(kernel, inputs.atlases, inputs.tables, shaded, ctx.energy),
  ])
}

/** Writes the parameters of `kernel` over its tiles of `laid`. */
function writeParams(
  ctx: CaptureContext,
  kernel: Kernel,
  laid: ReturnType<typeof lay>,
  atlases: SurfaceAtlases,
  settings: CaptureSettings,
) {
  const { paramWords, paramFloats } = ctx
  paramWords.fill(0)
  const at = CAPTURE_PARAMS.at
  paramWords[at.captureSide] = atlases.captureSide
  paramWords[at.atlasSide] = atlases.side
  paramWords[at.pages] = laid.pages
  paramWords[at.tiles] = laid.counts[KERNELS[kernel].tiles]
  paramWords[at.tileBase] = laid.bases[KERNELS[kernel].tiles]
  paramWords[at.resample] = settings.resample ? 1 : 0
  paramWords[at.radiosity] = settings.radiosity ? 1 : 0
  paramFloats[at.preExposure] = settings.preExposure
  paramFloats[at.invAtlasSide] = 1 / atlases.side
  paramFloats[at.invCaptureSide] = 1 / atlases.captureSide
  ctx.device.queue.writeBuffer(ctx.params[kernel], 0, paramWords)
}

/** Dispatches the kernels of `stage` over the pages `laid` on `open`: the light's resample only where the
 *  light is carried. */
function dispatchKernels(
  ctx: CaptureContext,
  stage: Stage,
  open: OpenPass,
  laid: ReturnType<typeof lay>,
  inputs: ResampleInputs | CaptureInputs,
  settings: CaptureSettings,
) {
  const pass = open.pass
  for (const kernel of ctx.order) {
    if (KERNELS[kernel].stage !== stage) continue
    if (kernel === 'resampleLighting' && !settings.resample) continue
    const tiles = laid.counts[KERNELS[kernel].tiles]
    if (!tiles) continue
    writeParams(ctx, kernel, laid, inputs.atlases, settings)
    const [x, y] = dispatchGrid(
      kernel === 'encode' ? ceilDiv(tiles, TILES_PER_GROUP) : tiles,
      ctx.width,
    )
    const group = groupOf(ctx, kernel, inputs)
    for (const entry of ctx.programs[kernel]!.entries) {
      pass.setPipeline(ctx.kernels[kernel].pipeline(entry))
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(x, y)
    }
  }
}

/** The capture's programs, pipelines and buffers on `device`, for an atlas `compressed` or not. */
function createCaptureContext(device: GPUDevice, compressed: boolean): CaptureContext {
  const programs = programsOf(compressed)
  const order = Object.keys(programs) as Kernel[]
  const paramWords = new Uint32Array(CAPTURE_PARAMS.words)
  const energy = device.createBuffer({
    label: 'Trillion3D surface cache shading energy',
    size: SHADING_ENERGY_ALONG_NORMAL.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(energy, 0, SHADING_ENERGY_ALONG_NORMAL)
  return {
    device,
    programs,
    order,
    kernels: pipelinesOf(device, programs, order, compressed),
    params: paramBuffersOf(device, order),
    energy,
    width: groupWidth(device.limits),
    paramWords,
    paramFloats: new Float32Array(paramWords.buffer),
    named: [],
    lists: {
      resample: { pageBuffer: undefined, tileBuffer: undefined },
      capture: { pageBuffer: undefined, tileBuffer: undefined },
    },
    encoded: [],
  }
}

/** The two stages of an image: the kernels that read the cards as they were, and those after the shading. */
function stagesOf(ctx: CaptureContext) {
  return {
    /**
     * Dispatches the kernels that read the cards as they were over `pages`, every page the image
     * captures, on `open`, before the image's tables go up: resample (the pages that copy a card) and,
     * where the light is carried (`settings.resample`), resampleLighting (all). `inputs.tables` are the
     * tables before the image.
     */
    resample(
      open: OpenPass,
      pages: readonly CapturePage[],
      inputs: ResampleInputs,
      settings: CaptureSettings,
    ) {
      if (!pages.length || (!settings.resample && !pages.some((page) => page.copyCard >= 0))) return
      const laid = lay(ctx, 'resample', pages, settings.dilate)
      dispatchKernels(ctx, 'resample', open, laid, inputs, settings)
    },
    /**
     * Dispatches the kernels after the shading over `pages` on `open`: resolve (the pages drawn), copy,
     * then, in a compressed atlas, the encoders of the blocks, and lights (all). `pages` holds the pages
     * the image serves alone: those drawn and shaded, and those that copy; a page mapped for a capture
     * that was not made is none of them, and is read by no one until it is (`confirmPages`).
     */
    encode(
      open: OpenPass,
      pages: readonly CapturePage[],
      inputs: CaptureInputs,
      settings: CaptureSettings,
    ) {
      ctx.encoded = []
      if (!pages.length) return
      const laid = lay(ctx, 'capture', pages, settings.dilate)
      ctx.encoded = pages
      dispatchKernels(ctx, 'capture', open, laid, inputs, settings)
    },
  }
}

/** The capture's kernels on `device`, for an atlas `compressed` or not: their pipelines, compiled off
 *  the frame; the lists and parameters they are given each image. */
export function createCaptureKernels(device: GPUDevice, compressed: boolean) {
  const ctx = createCaptureContext(device, compressed)
  const { kernels } = ctx
  const clear = compressed ? createBlockClear(device) : undefined

  return {
    /** Whether the atlas these kernels are for is compressed: the kernels are made again when it is not. */
    compressed,
    /** Whether every kernel is compiled. */
    get ready() {
      return Object.values(kernels).every((k) => k.ready) && (clear?.ready ?? true)
    },
    ...stagesOf(ctx),
    /**
     * Copies the blocks the last `encode` wrote into the compressed layers of `atlases`, on `encoder`: a
     * command of the encoder, so after the compute pass the encoders ran in. Nothing for an atlas that is
     * not compressed.
     */
    copyBlocks(encoder: GPUCommandEncoder, atlases: SurfaceAtlases) {
      copyBlockPages(encoder, atlases, ctx.encoded)
    },
    /** Empties the compressed layers of `atlases` on `encoder`, once their program is compiled; the
     *  other layers are `atlases.clear`'s. */
    clearBlocks(encoder: GPUCommandEncoder, atlases: SurfaceAtlases) {
      clear?.encode(encoder, atlases)
    },
    dispose() {
      for (const held of Object.values(ctx.lists)) {
        held.pageBuffer?.destroy()
        held.tileBuffer?.destroy()
      }
      clear?.dispose()
      for (const buffer of Object.values(ctx.params)) buffer.destroy()
      ctx.energy.destroy()
    },
  }
}

/** The capture's kernels (`createCaptureKernels`). */
export type CaptureKernels = ReturnType<typeof createCaptureKernels>
