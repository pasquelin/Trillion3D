import { readRectLightAtlasSetting } from '../../../../sdk-core/src/contracts/rectLightAtlasOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { RECT_ATLAS_BLIT_PASS, RECT_ATLAS_DEBUG_PASS } from '../../diagnostic/stage/passLabels.ts'
import { DEBUG_COLORS } from '../../hair/debugLines.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { preparedComputePipeline } from '../deferred/fullscreen.ts'
import {
  atlasFormatName,
  createDebugOverlay,
  switchColour,
  type OverlayRow,
} from '../debugOverlay.ts'
import { DEBUG_WGSL, debugAtlasRect } from './debugWgsl.ts'
import { slotWords } from './slotData.ts'

/** The compute pass that draws the atlas, once a device (the blit that lays it over the image is `../overlayBlit.ts`). */
const program = oncePerDevice((device: GPUDevice) =>
  preparedComputePipeline(device, {
    label: RECT_ATLAS_DEBUG_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: RECT_ATLAS_DEBUG_PASS, code: DEBUG_WGSL }),
      entryPoint: 'mainCs',
    },
  }),
)

const overlay = createDebugOverlay({
  label: RECT_ATLAS_DEBUG_PASS,
  blitLabel: RECT_ATLAS_BLIT_PASS,
  program,
})

/** Gives the debug view's resources back. */
export const disposeRectLightAtlasDebug = overlay.dispose

/** A boolean as a figure: its text and its colour. */
const flag = (on: boolean): readonly [string, number] => [on ? 'TRUE' : 'FALSE', switchColour(on)]

/** The figures of the atlas, one row each, in the order the reference prints them. */
function figureRows(rt: WebgpuPagesRuntime, used: number, occupied: number) {
  const frame = rt.lights.rectAtlas!
  const { gpu, manager } = frame
  const mip = Math.min(
    readRectLightAtlasSetting(rt, 'rectLightAtlasDebugMipLevel'),
    gpu.texture!.mipLevelCount - 1,
  )
  const orange = DEBUG_COLORS.orange
  const rows: OverlayRow[] = [
    ['Atlas resolution :', `${gpu.size.x} ${gpu.size.y}`, orange],
    ['Atlas max. MIP   :', `${gpu.texture!.mipLevelCount}`, orange],
    ['Atlas MIP Index  :', `${mip}`, orange],
    ['Atlas occupancy  :', `${((occupied / (gpu.size.x * gpu.size.y)) * 100).toFixed(2)}`, orange],
    ['Textures count   :', `${used}`, orange],
    ['Src. MIP bias    :', `${manager.layout.sourceMipBias}`, orange],
    ['Atlas format     :', atlasFormatName(gpu.texture!.format), orange],
    ...(
      [
        ['Force Update     :', 'rectLightAtlasForceUpdate'],
        ['Reset On Change  :', 'rectLightAtlasResetOnChange'],
        ['Clear Atlas      :', 'rectLightAtlasClear'],
      ] as const
    ).map(([name, setting]): OverlayRow => {
      const [text, colour] = flag(readRectLightAtlasSetting(rt, setting))
      return [name, text, colour]
    }),
  ]
  return { mip, rows }
}

/**
 * The atlas's debug view (`rectLightAtlasDebug`), over the display image: the figures of the atlas as text, then the atlas drawn small with its
 * slots, horizon lines and free rectangles (a compute pass writing a texture of the picture's size), laid over the image. Resources are
 * given back while the setting is off; nothing is drawn while no light has a picture in the atlas.
 */
export function encodeRectLightAtlasDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const asked =
    readRectLightAtlasSetting(rt, 'rectLightAtlasDebug') || rt.run.diagnostic === 'rect-light-atlas'
  if (!asked) return disposeRectLightAtlasDebug(rt)
  const frame = rt.lights.rectAtlas
  if (!frame?.gpu.texture) return
  overlay.encode(rt, device, encoder, cam, ({ width, shown, picture, upload }) => {
    const placed = frame.manager.slots.filter((s) => s.source && s.rect.origin.x >= 0)
    const occupied = placed.reduce((sum, s) => sum + s.rect.size.x * s.rect.size.y, 0)
    const { mip, rows } = figureRows(rt, placed.length, occupied)
    const { layout } = frame.manager
    const horizons = layout.horizons.map((h) => h.extended)
    const rect = debugAtlasRect(width, frame.gpu.size)
    const figures = new Uint32Array([
      frame.gpu.size.x,
      frame.gpu.size.y,
      rect.width,
      rect.height,
      placed.length,
      horizons.length,
      layout.freeRects.length,
      mip,
    ])
    return {
      rows,
      entries: shown(rect)
        ? [
            { binding: 0, resource: upload('figures', GPUBufferUsage.UNIFORM, figures) },
            { binding: 1, resource: frame.view! },
            { binding: 2, resource: postSamplers(device).clamped },
            {
              binding: 3,
              resource: upload(
                'slots',
                GPUBufferUsage.STORAGE,
                slotWords(placed.map((s) => s.rect)),
              ),
            },
            {
              binding: 4,
              resource: upload('horizons', GPUBufferUsage.STORAGE, slotWords(horizons)),
            },
            {
              binding: 5,
              resource: upload('free', GPUBufferUsage.STORAGE, slotWords(layout.freeRects)),
            },
            { binding: 6, resource: picture(rect) },
          ]
        : undefined,
    }
  })
}
