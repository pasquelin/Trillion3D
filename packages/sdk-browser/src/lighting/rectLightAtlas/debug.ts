import { readRectLightAtlasSetting } from '../../../../sdk-core/src/contracts/rectLightAtlasOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { chainReady, preparedComputePipeline, preparedPipeline } from '../deferred/fullscreen.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import { RECT_ATLAS_BLIT_PASS, RECT_ATLAS_DEBUG_PASS } from '../../diagnostic/stage/passLabels.ts'
import { DEBUG_COLORS, createDebugLines, type DebugLines } from '../../hair/debugLines.ts'
import { createDebugLinesGpu, type DebugLinesGpu } from '../../hair/debugLinesPass.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { BLIT_WGSL, DEBUG_WGSL } from './debugWgsl.ts'
import { slotWords } from './slotData.ts'
import type { AtlasRect } from './layout.ts'

/** The pixel the figures start at, and the pixels between two rows. */
const TEXT_LEFT = 50
const TEXT_TOP = 100
const TEXT_ROW = 14
/** The figures' names, padded to one column. */
const NAME_WIDTH = 18

/** The pipelines of the debug view, once a device: the compute pass that draws the atlas, and the blit that lays it over the image. */
const programs = oncePerDevice((device: GPUDevice) => {
  const compute = preparedComputePipeline(device, {
    label: RECT_ATLAS_DEBUG_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: RECT_ATLAS_DEBUG_PASS, code: DEBUG_WGSL }),
      entryPoint: 'mainCs',
    },
  })
  const blitModule = device.createShaderModule({ label: RECT_ATLAS_BLIT_PASS, code: BLIT_WGSL })
  const blit = preparedPipeline(device, {
    label: RECT_ATLAS_BLIT_PASS,
    layout: 'auto',
    vertex: { module: blitModule, entryPoint: 'fullscreen' },
    fragment: {
      module: blitModule,
      entryPoint: 'blit',
      targets: [
        {
          format: DISPLAY_FORMAT,
          blend: {
            color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })
  return { compute, blit }
})

/** What the debug view keeps of a runtime: the text lines and their pass, and the texture the atlas is drawn into. */
interface DebugState {
  readonly lines: DebugLines
  linesGpu?: DebugLinesGpu
  texture?: GPUTexture
}
const states = new WeakMap<object, DebugState>()

/** Gives the debug view's resources back. */
export function disposeRectLightAtlasDebug(owner: WebgpuPagesRuntime) {
  const state = states.get(owner)
  state?.linesGpu?.dispose()
  if (state?.texture && owner.gpu.device) retire(owner.gpu.device, state.texture)
  states.delete(owner)
}

/** A boolean as the text the figures give it. */
const word = (value: boolean) => (value ? 'TRUE' : 'FALSE')

/** The figures of the atlas, one row each, in the order the reference prints them. */
function figureRows(rt: WebgpuPagesRuntime, used: number, occupied: number) {
  const frame = rt.lights.rectAtlas!
  const { gpu, manager } = frame
  const mip = Math.min(
    readRectLightAtlasSetting(rt, 'rectLightAtlasDebugMipLevel'),
    gpu.texture!.mipLevelCount - 1,
  )
  return {
    mip,
    rows: [
      ['Atlas resolution :', `${gpu.size.x} ${gpu.size.y}`],
      ['Atlas max. MIP   :', `${gpu.texture!.mipLevelCount}`],
      ['Atlas MIP Index  :', `${mip}`],
      ['Atlas occupancy  :', `${((occupied / (gpu.size.x * gpu.size.y)) * 100).toFixed(2)}`],
      ['Textures count   :', `${used}`],
      ['Src. MIP bias    :', `${manager.layout.sourceMipBias}`],
      ['Atlas format     :', gpu.format === 'rg11b10ufloat' ? 'PF_FloatR11G11B10' : 'PF_FloatRGBA'],
      ['Force Update     :', word(readRectLightAtlasSetting(rt, 'rectLightAtlasForceUpdate'))],
      ['Reset On Change  :', word(readRectLightAtlasSetting(rt, 'rectLightAtlasResetOnChange'))],
      ['Clear Atlas      :', word(readRectLightAtlasSetting(rt, 'rectLightAtlasClear'))],
    ] as const,
  }
}

/**
 * The atlas's debug view (`rectLightAtlasDebug`), over the display image: the figures of the atlas as text, then the atlas drawn small with its
 * slots, horizon lines and free rectangles (a compute pass writing a texture of the display's size), laid over the image. Nothing is made
 * and nothing drawn while the setting is off or no light has a picture in the atlas.
 */
export function encodeRectLightAtlasDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const frame = rt.lights.rectAtlas
  const asked =
    readRectLightAtlasSetting(rt, 'rectLightAtlasDebug') || rt.run.diagnostic === 'rect-light-atlas'
  if (!asked || !frame?.gpu.texture || !gpu.displayView) return disposeRectLightAtlasDebug(rt)
  const state = states.get(rt) ?? { lines: createDebugLines() }
  states.set(rt, state)
  const [width, height] = gpu.displaySize
  const placed = frame.manager.slots.filter((s) => s.source && s.rect.origin.x >= 0)
  const occupied = placed.reduce((sum, s) => sum + s.rect.size.x * s.rect.size.y, 0)
  const { mip, rows } = figureRows(rt, placed.length, occupied)
  const { layout } = frame.manager
  const horizons = layout.horizons.map((h) => h.extended)
  // The atlas and the rectangles that mark it, drawn into a texture of the display's size.
  if (state.texture?.width !== width || state.texture.height !== height) {
    if (state.texture) retire(device, state.texture)
    state.texture = device.createTexture({
      label: RECT_ATLAS_DEBUG_PASS,
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  }
  const figures = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    figures,
    0,
    new Uint32Array([
      frame.gpu.size.x,
      frame.gpu.size.y,
      width,
      height,
      placed.length,
      horizons.length,
      layout.freeRects.length,
      mip,
    ]),
  )
  const storage = (rects: readonly AtlasRect[]) => {
    const words = slotWords(rects)
    const buffer = device.createBuffer({
      size: Math.max(16, words.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(buffer, 0, words)
    retire(device, buffer)
    return { buffer }
  }
  retire(device, figures)
  const programsOfDevice = programs(device)
  if (!chainReady(programsOfDevice.compute, programsOfDevice.blit)) return
  const compute = programsOfDevice.compute.get()!
  const blit = programsOfDevice.blit.get()!
  const sampler = postSamplers(device).clamped
  const pass = encoder.beginComputePass({ label: RECT_ATLAS_DEBUG_PASS })
  pass.setPipeline(compute)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: compute.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: figures } },
        { binding: 1, resource: frame.gpu.texture.createView() },
        { binding: 2, resource: sampler },
        { binding: 3, resource: storage(placed.map((s) => s.rect)) },
        { binding: 4, resource: storage(horizons) },
        { binding: 5, resource: storage(layout.freeRects) },
        { binding: 6, resource: state.texture.createView() },
      ],
    }),
  )
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8))
  pass.end()
  const draw = encoder.beginRenderPass({
    label: RECT_ATLAS_BLIT_PASS,
    colorAttachments: [{ view: gpu.displayView, loadOp: 'load', storeOp: 'store' }],
  })
  draw.setPipeline(blit)
  draw.setBindGroup(
    0,
    device.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: state.texture.createView() },
        { binding: 1, resource: sampler },
      ],
    }),
  )
  draw.draw(3)
  draw.end()
  // The figures, as text over the picture.
  state.lines.begin(cam.eye)
  rows.forEach(([name, value], at) => {
    const y = TEXT_TOP + at * TEXT_ROW
    state.lines.text(name.padEnd(NAME_WIDTH), TEXT_LEFT, y, DEBUG_COLORS.silver)
    const colour =
      value === 'TRUE'
        ? DEBUG_COLORS.green
        : value === 'FALSE'
          ? DEBUG_COLORS.red
          : DEBUG_COLORS.orange
    state.lines.text(value, TEXT_LEFT + (NAME_WIDTH + 1) * 8, y, colour)
  })
  const linesGpu = (state.linesGpu ??= createDebugLinesGpu(device))
  linesGpu.encode(
    encoder,
    gpu.displayView,
    gpu.displaySize,
    cam.viewProjectionRelative,
    state.lines,
    {},
  )
}
