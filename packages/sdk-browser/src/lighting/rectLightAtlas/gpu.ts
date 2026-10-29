import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { chainReady, preparedComputePipeline, preparedPipeline } from '../deferred/fullscreen.ts'
import {
  RECT_ATLAS_ADD_PASS,
  RECT_ATLAS_CLEAR_PASS,
  RECT_ATLAS_COPY_PASS,
  RECT_ATLAS_FILTER_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import type { AtlasConfig, AtlasUpdate } from './manager.ts'
import { atlasMipCount, type AtlasRect, type AtlasSlot, type Point } from './layout.ts'
import { ADD_WGSL, CLEAR_WGSL, COPY_WGSL, FILTER_WGSL } from './passWgsl.ts'
import { pictureProgram } from './pictures.ts'
import {
  FIGURE_BYTES,
  copyRects,
  figureBytes,
  filterRects,
  scaleOffsetWords,
  slotWords,
  type Figures,
} from './slotData.ts'

/** The pictures drawn into the atlas in one pass at most: the reference's eight bound textures. */
export const SLOTS_PER_ADD_PASS = 8

const VERTEX = 1
const FRAGMENT = 2

/** The texture format the atlas is made in: 11, 11 and 10 bits where the setting asks (0) and the device draws into it, else four 16-bit floats. */
export const atlasFormatFor = (device: GPUDevice, setting: number): GPUTextureFormat =>
  setting === 0 && device.features.has('rg11b10ufloat-renderable') ? 'rg11b10ufloat' : 'rgba16float'

/** The atlas on the device: its texture, with the size and format it was made with. */
export interface AtlasTexture {
  texture: GPUTexture | undefined
  size: Point
  format: GPUTextureFormat | undefined
}

export const noAtlasTexture = (): AtlasTexture => ({
  texture: undefined,
  size: { x: 0, y: 0 },
  format: undefined,
})

/** The pipelines and layouts of the passes that write into an atlas of `format`, once a device and format. */
const programs = oncePerDeviceKey((device: GPUDevice, format: GPUTextureFormat) => {
  const figures = [
    computeBufferEntry(0, 'read-only-storage', VERTEX),
    computeBufferEntry(1, 'read-only-storage', VERTEX),
    computeUniformEntry(2, {}, VERTEX | FRAGMENT),
  ]
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label, entries })
  const layouts = {
    figures: layout('rect light atlas figures', figures),
    add: layout('rect light atlas add', [
      computeTextureEntry(0, 'float', '2d', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
    ]),
    copy: layout('rect light atlas copy', [
      computeBufferEntry(0, 'read-only-storage', FRAGMENT),
      computeTextureEntry(1, 'unfilterable-float', '2d', FRAGMENT),
    ]),
    filter: layout('rect light atlas filter', [
      computeBufferEntry(0, 'read-only-storage', FRAGMENT),
      computeTextureEntry(1, 'float', '2d', FRAGMENT),
      computeSamplerEntry(2, 'filtering', FRAGMENT),
    ]),
  }
  const pipelineOf = (label: string, code: string, second: GPUBindGroupLayout) => {
    const module = device.createShaderModule({ label, code })
    return preparedPipeline(device, {
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.figures, second] }),
      vertex: { module, entryPoint: 'mainVs' },
      fragment: { module, entryPoint: 'mainPs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    })
  }
  return {
    layouts,
    add: pipelineOf(RECT_ATLAS_ADD_PASS, ADD_WGSL, layouts.add),
    copy: pipelineOf(RECT_ATLAS_COPY_PASS, COPY_WGSL, layouts.copy),
    filter: pipelineOf(RECT_ATLAS_FILTER_PASS, FILTER_WGSL, layouts.filter),
  }
})

/** A storage buffer holding `words`, retired at the frame's end. */
function storageBuffer(device: GPUDevice, label: string, words: ArrayBufferView) {
  const buffer = device.createBuffer({
    label,
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, words as unknown as GPUAllowSharedBufferSource)
  retire(device, buffer)
  return buffer
}

/** The pass's figures as a uniform buffer, retired at the frame's end. */
function figureBuffer(device: GPUDevice, figures: Figures) {
  const buffer = device.createBuffer({
    label: 'rect light atlas figures',
    size: FIGURE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, figureBytes(figures))
  retire(device, buffer)
  return buffer
}

/** The atlas as a texture of `size` in `format`, every mip level (`atlasMipCount`) drawable and sampled. */
export function makeAtlasTexture(device: GPUDevice, size: Point, format: GPUTextureFormat) {
  const storage = format === 'rgba16float' ? GPUTextureUsage.STORAGE_BINDING : 0
  return device.createTexture({
    label: 'Trillion3D rect light atlas',
    size: [size.x, size.y],
    format,
    mipLevelCount: Math.max(1, atlasMipCount(size)),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST |
      storage,
  })
}

const levelView = (texture: GPUTexture, level: number) =>
  texture.createView({ baseMipLevel: level, mipLevelCount: 1 })

/** The size of mip level `level` of an atlas of `size`. */
const levelSize = (size: Point, level: number): Point => ({
  x: Math.max(1, size.x >> level),
  y: Math.max(1, size.y >> level),
})

/** The debug clear's layout and compute pipeline, once a device. */
const clearProgram = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    entries: [computeUniformEntry(0), computeStorageTextureEntry(1, 'rgba16float')],
  })
  const module = device.createShaderModule({ label: RECT_ATLAS_CLEAR_PASS, code: CLEAR_WGSL })
  return {
    layout,
    pipeline: preparedComputePipeline(device, {
      label: RECT_ATLAS_CLEAR_PASS,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'mainCs' },
    }),
  }
})

/** Whether the pipelines an update with these settings draws with are compiled (the frames wait for the ones that are not, `preparedPipeline`). */
export const rectAtlasProgramsReady = (
  device: GPUDevice,
  format: GPUTextureFormat,
  debugClear: boolean,
) => {
  const p = programs(device, format)
  return chainReady(
    p.add,
    p.copy,
    p.filter,
    pictureProgram(device),
    ...(debugClear && format === 'rgba16float' ? [clearProgram(device).pipeline] : []),
  )
}

/** Clears every mip level of the atlas to transparent, or to the magenta of the debug clear: by the compute shader where the texture is a storage
 *  texture, else by clearing the levels as render targets. */
export function encodeClear(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  target: AtlasTexture,
  debug: boolean,
) {
  const texture = target.texture!
  for (let level = 0; level < texture.mipLevelCount; level++) {
    const size = levelSize(target.size, level)
    if (debug && target.format === 'rgba16float') {
      const { layout, pipeline } = clearProgram(device)
      const sizes = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(sizes, 0, new Uint32Array([size.x, size.y, 0, 0]))
      retire(device, sizes)
      const pass = encoder.beginComputePass({ label: RECT_ATLAS_CLEAR_PASS })
      pass.setPipeline(pipeline.get()!)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: sizes } },
            { binding: 1, resource: levelView(texture, level) },
          ],
        }),
      )
      pass.dispatchWorkgroups(Math.ceil(size.x / 8), Math.ceil(size.y / 8))
      pass.end()
      continue
    }
    encoder
      .beginRenderPass({
        label: RECT_ATLAS_CLEAR_PASS,
        colorAttachments: [
          {
            view: levelView(texture, level),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: debug ? { r: 1, g: 0, b: 1, a: 1 } : { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      })
      .end()
  }
}

/** A render pass over one level of the atlas, loading what it holds, that draws `count` rectangles of `slots` (`firstInstance` the first). */
function drawRects(
  encoder: GPUCommandEncoder,
  label: string,
  view: GPUTextureView,
  pipeline: GPURenderPipeline,
  bindGroups: readonly GPUBindGroup[],
  draws: readonly (readonly [instances: number, first: number, group?: GPUBindGroup])[],
) {
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setPipeline(pipeline)
  bindGroups.forEach((group, at) => pass.setBindGroup(at, group))
  for (const [instances, first, group] of draws) {
    if (group) pass.setBindGroup(1, group)
    pass.draw(6, instances, 0, first)
  }
  pass.end()
}

/** The bind group of the slots and figures a pass draws its rectangles with. */
function figuresGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  rects: readonly AtlasRect[],
  scaleOffsets: readonly AtlasSlot[] | undefined,
  figures: Figures,
) {
  return device.createBindGroup({
    layout,
    entries: [
      {
        binding: 0,
        resource: { buffer: storageBuffer(device, 'rect light slots', slotWords(rects)) },
      },
      {
        binding: 1,
        resource: {
          buffer: storageBuffer(
            device,
            'rect light scale offsets',
            scaleOffsetWords(scaleOffsets ?? []),
          ),
        },
      },
      { binding: 2, resource: { buffer: figureBuffer(device, figures) } },
    ],
  })
}

/** Every slot of `copies` moved from `from` to `to`, a mip level at a time. */
export function encodeCopy(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  from: AtlasTexture,
  to: AtlasTexture,
  copies: AtlasUpdate['copySlots'],
) {
  const program = programs(device, to.format!)
  for (let mip = 0; mip < from.texture!.mipLevelCount; mip++) {
    const rects = copyRects(copies, mip)
    if (!rects.to.length) continue
    const figures = figuresGroup(device, program.layouts.figures, rects.to, undefined, {
      atlas: levelSize(to.size, mip),
      hasScaleOffset: false,
      mip,
    })
    const source = device.createBindGroup({
      layout: program.layouts.copy,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: storageBuffer(device, 'rect light source slots', slotWords(rects.from)),
          },
        },
        { binding: 1, resource: from.texture!.createView() },
      ],
    })
    drawRects(
      encoder,
      RECT_ATLAS_COPY_PASS,
      levelView(to.texture!, mip),
      program.copy.get()!,
      [figures, source],
      [[rects.to.length, 0]],
    )
  }
}

/** The pictures of `drawn` drawn into level 0 of the atlas, eight a pass (`SLOTS_PER_ADD_PASS`), each read `mipBias` levels smaller than its own. */
export function encodeAdd(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  target: AtlasTexture,
  drawn: readonly AtlasSlot[],
  mipBias: number,
  pictures: (slot: AtlasSlot) => GPUTextureView,
) {
  const program = programs(device, target.format!)
  const figures = figuresGroup(
    device,
    program.layouts.figures,
    drawn.map((s) => s.rect),
    drawn,
    { atlas: target.size, hasScaleOffset: true, mipBias },
  )
  const sampler = postSamplers(device).clamped
  for (let first = 0; first < drawn.length; first += SLOTS_PER_ADD_PASS) {
    const batch = drawn.slice(first, first + SLOTS_PER_ADD_PASS)
    drawRects(
      encoder,
      RECT_ATLAS_ADD_PASS,
      levelView(target.texture!, 0),
      program.add.get()!,
      [figures],
      batch.map((slot, at) => [
        1,
        first + at,
        device.createBindGroup({
          layout: program.layouts.add,
          entries: [
            { binding: 0, resource: pictures(slot) },
            { binding: 1, resource: sampler },
          ],
        }),
      ]),
    )
  }
}

/** Every mip level past the first of the slots `drawn` filtered from the level over it (`quality` 0 a box of 2 by 2 texels, 1 a Gaussian approximation). */
export function encodeFilter(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  target: AtlasTexture,
  drawn: readonly AtlasSlot[],
  config: Pick<AtlasConfig, 'filterQuality'>,
) {
  const program = programs(device, target.format!)
  const sampler = postSamplers(device).clamped
  for (let mip = 1; mip < target.texture!.mipLevelCount; mip++) {
    const rects = filterRects(drawn, mip)
    if (!rects.to.length) continue
    const figures = figuresGroup(device, program.layouts.figures, rects.to, undefined, {
      atlas: levelSize(target.size, mip),
      hasScaleOffset: false,
      quality: config.filterQuality,
      source: levelSize(target.size, mip - 1),
    })
    const source = device.createBindGroup({
      layout: program.layouts.filter,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: storageBuffer(device, 'rect light source slots', slotWords(rects.from)),
          },
        },
        { binding: 1, resource: levelView(target.texture!, mip - 1) },
        { binding: 2, resource: sampler },
      ],
    })
    drawRects(
      encoder,
      RECT_ATLAS_FILTER_PASS,
      levelView(target.texture!, mip),
      program.filter.get()!,
      [figures, source],
      [[rects.to.length, 0]],
    )
  }
}
