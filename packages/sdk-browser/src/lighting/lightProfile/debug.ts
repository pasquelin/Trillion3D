import { readLightProfileSetting } from '../../../../sdk-core/src/contracts/lightProfileOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  LIGHT_PROFILE_BLIT_PASS,
  LIGHT_PROFILE_DEBUG_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { DEBUG_COLORS, debugColor } from '../../hair/debugLines.ts'
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
import { PROFILE_DEBUG_WGSL, profileDebugRect } from './debugWgsl.ts'
import { PROFILE_ATLAS_FORMAT, type LightProfileDebugFigures } from './profileAtlas.ts'

/** The compute pass that draws the atlas, once a device (the blit that lays it over the image is `../overlayBlit.ts`). */
const program = oncePerDevice((device: GPUDevice) =>
  preparedComputePipeline(device, {
    label: LIGHT_PROFILE_DEBUG_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        label: LIGHT_PROFILE_DEBUG_PASS,
        code: PROFILE_DEBUG_WGSL,
      }),
      entryPoint: 'mainCs',
    },
  }),
)

const overlay = createDebugOverlay({
  label: LIGHT_PROFILE_DEBUG_PASS,
  blitLabel: LIGHT_PROFILE_BLIT_PASS,
  program,
})

/** Gives the debug view's resources back. */
export const disposeLightProfileDebug = overlay.dispose

/** The figures of the atlas as rows of a name, its text and its colour, in the order the reference prints them. */
function figureRows(atlas: LightProfileDebugFigures, forceUpdate: boolean) {
  const used = atlas.used.reduce((sum, u) => sum + u, 0)
  const occupancy = used / atlas.slices
  const rows: OverlayRow[] = [
    ['Atlas resolution :', `${atlas.side}x${atlas.side}`, DEBUG_COLORS.orange],
    ['Atlas slice      :', `${used}/${atlas.slices}`, DEBUG_COLORS.orange],
    [
      'Atlas occupancy  :',
      `${(occupancy * 100).toFixed(1)}%`,
      debugColor(Math.min(1, occupancy), 1 - Math.min(1, occupancy), 0),
    ],
    ['Slot count       :', `${atlas.held}`, DEBUG_COLORS.orange],
  ]
  if (atlas.held > atlas.slices)
    rows.push([
      'Slot over budget :',
      `${atlas.held - atlas.slices} - ${atlas.held}/${atlas.slices}`,
      DEBUG_COLORS.red,
    ])
  rows.push(
    ['Force Update     :', forceUpdate ? 'True' : 'False', switchColour(forceUpdate)],
    ['Atlas format     :', atlasFormatName(PROFILE_ATLAS_FORMAT), DEBUG_COLORS.orange],
  )
  return rows
}

/**
 * The profile atlas's debug view (`lightProfileAtlasDebug`), over the display image: the figures of the atlas as text, then the atlas drawn
 * small as a grid of its slices (a compute pass writing a texture of the picture's size), laid over the image. Resources are given back
 * while the setting is off and the view is not asked; nothing is drawn while no light names a profile.
 */
export function encodeLightProfileDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const asked =
    readLightProfileSetting(rt, 'lightProfileAtlasDebug') ||
    rt.run.diagnostic === 'light-profile-atlas'
  if (!asked) return disposeLightProfileDebug(rt)
  const atlas = rt.lights.lightProfile?.atlas.debugFigures()
  if (!atlas) return
  overlay.encode(rt, device, encoder, cam, ({ width, shown, picture, upload }) => {
    const rect = profileDebugRect(width)
    return {
      rows: figureRows(atlas, readLightProfileSetting(rt, 'lightProfileAtlasForceUpdate')),
      entries: shown(rect)
        ? [
            {
              binding: 0,
              resource: upload(
                'figures',
                GPUBufferUsage.UNIFORM,
                new Uint32Array([
                  atlas.side,
                  atlas.side,
                  rect.width,
                  rect.height,
                  atlas.slices,
                  0,
                  0,
                  0,
                ]),
              ),
            },
            { binding: 1, resource: upload('used', GPUBufferUsage.STORAGE, atlas.used) },
            { binding: 2, resource: postSamplers(device).clamped },
            { binding: 3, resource: atlas.view },
            { binding: 4, resource: picture(rect) },
          ]
        : undefined,
    }
  })
}
