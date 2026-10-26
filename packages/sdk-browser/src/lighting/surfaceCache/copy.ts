import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { CapturePage } from '../../../../sdk-core/src/lighting/surfaceCache/captures.ts'
import { dispatchGrid, groupWidth } from '../../gpu/dispatch/grid.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { SurfaceAtlases } from './atlases.ts'
import { createKernel, type Kernel as CacheKernel } from './kernel.ts'
import { copyBlockPages, createBlockClear } from './compress.ts'
import { ENCODE_ENTRIES, ENCODE_WGSL, TILES_PER_GROUP } from './compressWgsl.ts'
import {
  COPY_COMPRESSED_WGSL,
  COPY_WGSL,
  LIGHTS_WGSL,
  RESAMPLE_COMPRESSED_WGSL,
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
 * THE CAPTURE'S KERNELS ON THE GPU (`copyWgsl.ts`): the pipelines of the four — five for a compressed
 * atlas —, and what an image gives them — the pages it captures, laid as a list of page entries and
 * the lists of the tiles of those pages each kernel works over, written to the buffers they read. The
 * kernels run in the order the capture needs: the shaded surfaces resolved to the cards' encodings,
 * the pages that copy another card's texels filled from the atlas as it was, then every page copied
 * into the atlas — its depth alone, for a compressed atlas, whose other layers are blocks the
 * encoders (`compressWgsl.ts`) write to a staging buffer, which `copyBlocks` puts in the atlas after
 * the pass — and given its first light.
 */

const ro = 'read-only-storage' as const

/** The kernels' names. `encode` is the compressed atlas's alone. */
type Kernel = 'resolve' | 'resample' | 'copy' | 'encode' | 'lights'

/** A kernel's program and its entry points. */
interface Program {
  readonly code: string
  readonly entries: readonly string[]
}

/** The program of each kernel of an atlas `compressed` or not, in the order they run: the encoders of
 *  the blocks, three entry points — one for each layer in blocks —, are the compressed atlas's alone. */
function programsOf(compressed: boolean) {
  const kernels: Partial<Record<Kernel, Program>> = {
    resolve: { code: RESOLVE_WGSL, entries: ['resolvePages'] },
    resample: {
      code: compressed ? RESAMPLE_COMPRESSED_WGSL : RESAMPLE_WGSL,
      entries: ['resamplePages'],
    },
    copy: { code: compressed ? COPY_COMPRESSED_WGSL : COPY_WGSL, entries: ['copyPages'] },
  }
  if (compressed) kernels.encode = { code: ENCODE_WGSL, entries: ENCODE_ENTRIES }
  kernels.lights = { code: LIGHTS_WGSL, entries: ['lightsPages'] }
  return kernels
}

/** The layout entries of the kernels of an atlas `compressed` or not, past their parameters (binding 0, the
 *  kernel's own): the pages' entries and the tile lists every kernel reads, then what it names. */
function layoutEntriesOf(compressed: boolean): Record<Kernel, GPUBindGroupLayoutEntry[]> {
  const write = (binding: number, format: GPUTextureFormat) =>
    computeStorageTextureEntry(binding, format)
  const formats = atlasFormats(compressed)
  /** The capture atlas's layers, read: the copy's and the encoders' bindings 3 to 6. */
  const captureLayers = () => [
    computeTextureEntry(3, 'float'),
    computeTextureEntry(4, 'float'),
    computeTextureEntry(5, 'uint'),
    computeTextureEntry(6, 'unfilterable-float'),
  ]
  const lists = [computeBufferEntry(1, ro), computeBufferEntry(2, ro)]
  const layouts: Record<Kernel, GPUBindGroupLayoutEntry[]> = {
    resolve: [
      computeBufferEntry(3, ro),
      computeTextureEntry(4, 'uint'),
      computeTextureEntry(5, 'float', '2d-array'),
      write(6, CAPTURE_FORMATS.albedo),
      write(7, CAPTURE_FORMATS.normal),
      write(8, CAPTURE_FORMATS.emissive),
    ],
    resample: [
      ...surfaceCacheReadLayoutEntries(3, { feedback: false, compressed }),
      write(11, CAPTURE_FORMATS.albedo),
      write(12, CAPTURE_FORMATS.normal),
      write(13, CAPTURE_FORMATS.emissive),
      write(14, CAPTURE_FORMATS.depth),
    ],
    copy: [
      ...captureLayers(),
      write(7, formats.depth),
      ...(compressed
        ? []
        : [write(8, formats.albedo), write(9, formats.normal), write(10, formats.emissive)]),
    ],
    encode: [...captureLayers(), computeBufferEntry(7, 'storage')],
    lights: [
      computeTextureEntry(3, 'uint'),
      write(4, formats.direct),
      write(5, formats.indirect),
      write(6, formats.final),
      write(7, formats.frames),
    ],
  }
  for (const entries of Object.values(layouts)) entries.unshift(...lists)
  return layouts
}

/** What the kernels read beside the pages: the atlases, the tables, the capture's shaded surfaces. */
export interface CaptureInputs {
  readonly atlases: SurfaceAtlases
  readonly tables: GPUBuffer
  /** The colours of the surfaces the classes shaded (`CardShading.surfaces`). */
  readonly colours: GPUTextureView
}

/** What the kernels run with in an image. */
export interface CaptureSettings {
  /** Whether every page dilates by a texel (`surfaceCacheDilationMode` 2). */
  readonly dilate: boolean
  /** Whether a captured page starts with its emission as its light (`surfaceCacheResampleLighting`). */
  readonly resample: boolean
  /** The number the light is kept multiplied by. */
  readonly preExposure: number
}

/** The bindings of each kernel's bind group after its parameters, the pages' entries and the tile lists: the resources it names. */
function bindingsOf(inputs: CaptureInputs): Partial<Record<Kernel, GPUBindGroupEntry[]>> {
  const { atlases } = inputs
  const { physical: p, capture: c } = atlases
  const view = (resource: GPUTextureView, binding: number) => ({ binding, resource })
  return {
    resolve: [
      { binding: 3, resource: { buffer: inputs.tables } },
      view(c.ids, 4),
      view(inputs.colours, 5),
      view(c.albedo, 6),
      view(c.normal, 7),
      view(c.emissive, 8),
    ],
    resample: [
      { binding: 3, resource: { buffer: inputs.tables } },
      view(p.depth, 4),
      view(p.albedo, 5),
      view(p.normal, 6),
      view(p.emissive, 7),
      view(p.direct, 8),
      view(p.indirect, 9),
      view(p.final, 10),
      view(c.albedo, 11),
      view(c.normal, 12),
      view(c.emissive, 13),
      view(c.depth, 14),
    ],
    copy: [
      view(c.albedo, 3),
      view(c.normal, 4),
      view(c.emissive, 5),
      view(c.depth, 6),
      view(p.depth, 7),
      ...(atlases.compressed ? [] : [view(p.albedo, 8), view(p.normal, 9), view(p.emissive, 10)]),
    ],
    ...(atlases.blocks && {
      encode: [
        view(c.albedo, 3),
        view(c.normal, 4),
        view(c.emissive, 5),
        view(c.depth, 6),
        { binding: 7, resource: { buffer: atlases.blocks.staging } },
      ],
    }),
    lights: [
      view(c.emissive, 3),
      view(p.direct, 4),
      view(p.indirect, 5),
      view(p.final, 6),
      view(p.frames, 7),
    ],
  }
}

/** What the capture's kernels keep between two images. */
interface CaptureContext {
  readonly device: GPUDevice
  readonly programs: Partial<Record<Kernel, Program>>
  readonly order: Kernel[]
  readonly kernels: Record<Kernel, CacheKernel<string>>
  readonly params: Record<Kernel, GPUBuffer>
  readonly width: number
  readonly paramWords: Uint32Array<ArrayBuffer>
  readonly paramFloats: Float32Array
  /** What the groups name, in the order `Kernel.group` compares them. */
  readonly named: unknown[]
  pageBuffer: GPUBuffer | undefined
  tileBuffer: GPUBuffer | undefined
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
        undefined,
        CAPTURE_PARAMS.words * 4,
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

/** The page entries of `pages` and the lists of their tiles. */
function pageEntriesOf(pages: readonly CapturePage[], dilate: boolean) {
  const entryWords = new Uint32Array(Math.max(1, pages.length) * PAGE_ENTRY_WORDS)
  const floats = new Float32Array(entryWords.buffer)
  const lists: Record<'draw' | 'copy' | 'all', number[]> = { draw: [], copy: [], all: [] }
  pages.forEach((page, at) => {
    const base = at * PAGE_ENTRY_WORDS
    const { captureRect: c, atlasRect: a, uv } = page
    const copy = page.copyCard >= 0
    entryWords.set([c.minX, c.minY, c.maxX, c.maxY], base)
    entryWords.set(
      [
        a.minX,
        a.minY,
        page.card,
        (copy ? PAGE_FLAGS.copy : 0) |
          (page.axisXFlipped ? PAGE_FLAGS.flipped : 0) |
          (dilate && !copy ? PAGE_FLAGS.dilate : 0) |
          (page.fresh ? PAGE_FLAGS.fresh : 0),
      ],
      base + 4,
    )
    floats.set(uv, base + 8)
    entryWords[base + 12] = Math.max(page.copyCard, 0)
    const across = ceilDiv(c.maxX - c.minX, TILE),
      down = ceilDiv(c.maxY - c.minY, TILE)
    for (let ty = 0; ty < down; ty++)
      for (let tx = 0; tx < across; tx++) {
        const tile = tx | (ty << 4) | (at << 8)
        ;(copy ? lists.copy : lists.draw).push(tile)
        lists.all.push(tile)
      }
  })
  return { entryWords, lists }
}

/** Writes the entries of `pages` and the lists of their tiles; the buffers grow with them. */
function lay(ctx: CaptureContext, pages: readonly CapturePage[], dilate: boolean) {
  const { device } = ctx
  const { entryWords, lists } = pageEntriesOf(pages, dilate)
  const tiles = Uint32Array.from([...lists.draw, ...lists.copy, ...lists.all])
  const entries = pages.length
  ctx.pageBuffer = sizedBuffer(
    device,
    ctx.pageBuffer,
    Math.max(64, entries) * PAGE_ENTRY_WORDS * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D surface cache pages',
  )
  ctx.tileBuffer = sizedBuffer(
    device,
    ctx.tileBuffer,
    Math.max(1024, tiles.length) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    'Trillion3D surface cache tiles',
  )
  device.queue.writeBuffer(ctx.pageBuffer, 0, entryWords)
  if (tiles.length) device.queue.writeBuffer(ctx.tileBuffer, 0, tiles)
  // The encoders and the lights work over every page's tiles, the copy too.
  const every = lists.all.length
  const from = lists.draw.length + lists.copy.length
  return {
    pages: entries,
    tiles: {
      resolve: lists.draw.length,
      resample: lists.copy.length,
      copy: every,
      encode: every,
      lights: every,
    },
    bases: { resolve: 0, resample: lists.draw.length, copy: from, encode: from, lights: from },
  }
}

/** The bind group of `kernel`, made again when a resource it names moved. */
function groupOf(ctx: CaptureContext, kernel: Kernel, inputs: CaptureInputs) {
  const { named } = ctx
  named[0] = ctx.pageBuffer
  named[1] = ctx.tileBuffer
  named[2] = inputs.atlases
  named[3] = inputs.tables
  named[4] = inputs.colours
  return ctx.kernels[kernel].group(named, () => [
    { binding: 0, resource: { buffer: ctx.params[kernel] } },
    { binding: 1, resource: { buffer: ctx.pageBuffer! } },
    { binding: 2, resource: { buffer: ctx.tileBuffer! } },
    ...bindingsOf(inputs)[kernel]!,
  ])
}

/** Writes the parameters of `kernel` over `tiles` tiles from `laid`. */
function writeParams(
  ctx: CaptureContext,
  kernel: Kernel,
  laid: ReturnType<typeof lay>,
  tiles: number,
  atlases: SurfaceAtlases,
  settings: CaptureSettings,
) {
  const { paramWords, paramFloats } = ctx
  paramWords.fill(0)
  const at = CAPTURE_PARAMS.at
  paramWords[at.captureSide] = atlases.captureSide
  paramWords[at.atlasSide] = atlases.side
  paramWords[at.pages] = laid.pages
  paramWords[at.tiles] = tiles
  paramWords[at.tileBase] = laid.bases[kernel]
  paramWords[at.resample] = settings.resample ? 1 : 0
  paramFloats[at.preExposure] = settings.preExposure
  paramFloats[at.invAtlasSide] = 1 / atlases.side
  paramFloats[at.invCaptureSide] = 1 / atlases.captureSide
  ctx.device.queue.writeBuffer(ctx.params[kernel], 0, paramWords)
}

/** Dispatches the kernels over the pages `laid` on `open`. */
function dispatchKernels(
  ctx: CaptureContext,
  open: OpenPass,
  laid: ReturnType<typeof lay>,
  inputs: CaptureInputs,
  settings: CaptureSettings,
) {
  const pass = open.pass
  for (const kernel of ctx.order) {
    const tiles = laid.tiles[kernel]
    if (!tiles) continue
    writeParams(ctx, kernel, laid, tiles, inputs.atlases, settings)
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
  return {
    device,
    programs,
    order,
    kernels: pipelinesOf(device, programs, order, compressed),
    params: paramBuffersOf(device, order),
    width: groupWidth(device.limits),
    paramWords,
    paramFloats: new Float32Array(paramWords.buffer),
    named: [],
    pageBuffer: undefined,
    tileBuffer: undefined,
    encoded: [],
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
    /**
     * Dispatches the kernels over `pages` on `open`: resolve (the pages drawn), resample (the pages
     * that copy a card), copy, then, in a compressed atlas, the encoders of the blocks, and lights
     * (all). `pages` holds the pages the image serves alone: those drawn and shaded, and those that
     * copy; a page mapped for a capture that was not made is none of them, and is read by no one until
     * it is (`confirmPages`).
     */
    encode(
      open: OpenPass,
      pages: readonly CapturePage[],
      inputs: CaptureInputs,
      settings: CaptureSettings,
    ) {
      ctx.encoded = []
      if (!pages.length) return
      const laid = lay(ctx, pages, settings.dilate)
      ctx.encoded = pages
      dispatchKernels(ctx, open, laid, inputs, settings)
    },
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
      ctx.pageBuffer?.destroy()
      ctx.tileBuffer?.destroy()
      clear?.dispose()
      for (const buffer of Object.values(ctx.params)) buffer.destroy()
    },
  }
}

/** The capture's kernels (`createCaptureKernels`). */
export type CaptureKernels = ReturnType<typeof createCaptureKernels>
