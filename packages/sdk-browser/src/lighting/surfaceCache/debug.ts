import { mipOf } from '../../../../sdk-core/src/lighting/surfaceCache/cardTypes.ts'
import {
  isMapped,
  type SurfaceCache,
} from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { computeTextureEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { CANVAS_FORMAT } from '../../gpu/core/canvasFormat.ts'
import type { SurfaceAtlases } from './atlases.ts'
import { ATLAS_VIEW_UNIFORM, ATLAS_VIEW_WGSL, TILE_LOCKED } from './debugWgsl.ts'
import { TILE } from './layout.ts'

/**
 * THE VIEWS OF THE ATLAS (the diagnostic modes `surface-cache-…`): the whole atlas drawn onto the
 * canvas as one picture (`debugWgsl.ts`), its layers as the GPU holds them, and what the CPU knows of
 * each tile of 8 × 8 texels — the card that holds it, whether its page is of a card's coarsest level,
 * the image it was captured at —, written each image the view is shown. Made when the view is chosen,
 * given back when it is left.
 */

/** The words of a tile of the atlas's information: its card plus one — 0 for none — and the image its
 *  page was captured at. */
const TILE_WORDS = 2

/** Fills `out`, two words a tile of an atlas of `side` texels, from the pages `cache` holds: the card
 *  each tile belongs to, the coarsest level's bit, the capture's image. */
function fillTileInfo(cache: SurfaceCache, side: number, out: Uint32Array) {
  const across = side / TILE
  out.fill(0)
  for (let index = 0; index < cache.pages.length; index++) {
    if (!cache.pages.has(index)) continue
    const page = cache.pages.at(index)
    if (!isMapped(page) || !cache.cards.has(page.card)) continue
    const locked = mipOf(cache.cards.at(page.card), page.resLevel).locked
    const first = (page.card + 1) | (locked ? TILE_LOCKED : 0)
    const captured = cache.captured.has(index) ? cache.captured.keyOf(index) : 0
    for (let y = page.minY / TILE; y < page.maxY / TILE; y++)
      for (let x = page.minX / TILE; x < page.maxX / TILE; x++) {
        out[(y * across + x) * TILE_WORDS] = first >>> 0
        out[(y * across + x) * TILE_WORDS + 1] = captured
      }
  }
}

/** The layout and the pipeline of the viewer. */
function createViewerPipeline(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: ATLAS_VIEW_UNIFORM.words * 4 }, fragment),
      computeTextureEntry(1, 'float', '2d', fragment),
      computeTextureEntry(2, 'float', '2d', fragment),
      computeTextureEntry(3, 'uint', '2d', fragment),
      computeBufferEntry(4, 'read-only-storage', fragment),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D surface cache atlas view',
    code: ATLAS_VIEW_WGSL,
  })
  const pipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      'atlas',
      [{ format: CANVAS_FORMAT }],
      'Trillion3D surface cache atlas view',
    ),
  ).ask()
  return { layout, pipeline }
}

/** The tiles' information on the GPU and its host copy. */
interface TileInfo {
  buffer: GPUBuffer | undefined
  words: Uint32Array<ArrayBuffer>
}

/** Room for `wanted` words in `info`, its buffer made again where it is not that size. */
function ensureTiles(device: GPUDevice, info: TileInfo, wanted: number) {
  if (info.buffer && info.words.length === wanted) return
  if (info.buffer) retire(device, info.buffer)
  info.words = new Uint32Array(wanted)
  info.buffer = device.createBuffer({
    label: 'Trillion3D surface cache tiles view',
    size: wanted * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}

/** Writes the viewer's uniform: the view `code`, the atlas's `side` texels and `across` tiles, the image, the canvas's `size`. */
function writeViewUniform(
  words: Uint32Array,
  floats: Float32Array,
  view: {
    code: number
    side: number
    across: number
    frame: number
    size: readonly [number, number]
  },
) {
  const at = ATLAS_VIEW_UNIFORM.at
  words[at.view] = view.code
  words[at.side] = view.side
  words[at.tiles] = view.across
  words[at.frame] = view.frame
  floats[at.canvas] = view.size[0]
  floats[at.canvas + 1] = view.size[1]
}

/** The group over the uniform, the atlas's layers and the tiles' information. */
const atlasGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  uniform: GPUBuffer,
  atlases: SurfaceAtlases,
  tiles: GPUBuffer,
) =>
  device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: atlases.physical.albedo },
      { binding: 2, resource: atlases.physical.normal },
      { binding: 3, resource: atlases.physical.depth },
      { binding: 4, resource: { buffer: tiles } },
    ],
  })

/** The viewer of the atlas on `device`. */
export function createAtlasViewer(device: GPUDevice) {
  const { layout, pipeline } = createViewerPipeline(device)
  const uniform = device.createBuffer({
    label: 'Trillion3D surface cache atlas view uniform',
    size: ATLAS_VIEW_UNIFORM.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(ATLAS_VIEW_UNIFORM.words)
  const floats = new Float32Array(words.buffer)
  const info: TileInfo = { buffer: undefined, words: new Uint32Array(0) }
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 1],
  }
  return {
    /** Whether the viewer's pipeline is compiled. */
    get ready() {
      return pipeline.ready
    },
    /**
     * Draws the atlas `atlases` as the view `code` (`ATLAS_VIEWS`) onto `canvas`, `size` texels, in a
     * render pass labelled `label`: its tiles' information is from `cache`, the image is `frame`.
     */
    encode(
      encoder: GPUCommandEncoder,
      label: string,
      atlases: SurfaceAtlases,
      cache: SurfaceCache,
      code: number,
      canvas: GPUTextureView,
      size: readonly [number, number],
    ) {
      const side = atlases.side,
        across = side / TILE
      const drawn = pipeline.get()
      if (!drawn) return
      ensureTiles(device, info, across * across * TILE_WORDS)
      fillTileInfo(cache, side, info.words)
      device.queue.writeBuffer(info.buffer!, 0, info.words)
      writeViewUniform(words, floats, { code, side, across, frame: cache.frame, size })
      device.queue.writeBuffer(uniform, 0, words)
      const group = atlasGroup(device, layout, uniform, atlases, info.buffer!)
      target.view = canvas
      const pass = encoder.beginRenderPass({ label, colorAttachments: [target] })
      pass.setPipeline(drawn)
      pass.setBindGroup(0, group)
      pass.draw(3)
      pass.end()
    },
    dispose() {
      uniform.destroy()
      info.buffer?.destroy()
    },
  }
}

/** The viewer of the atlas (`createAtlasViewer`). */
export type AtlasViewer = ReturnType<typeof createAtlasViewer>
