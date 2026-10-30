import { PREVIEW_LAYOUT_NAMES } from '../../../../../sdk-core/src/texture/previewFormat.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInBuffer, standInTexture } from '../../../gpu/core/standIns.ts'
import { arrayView } from '../../../gpu/core/textureViews.ts'
import { GRAPH_FRAME_BYTES } from '../../../visibility/shader/graphFrameWgsl.ts'
import type { SceneMaskResources } from './sceneMaskWgsl.ts'

/** The words of the page table the stand-in holds: a storage binding is never empty. */
const NONE_PAGE_WORDS = 4

/**
 * WHAT THE ANY-HIT TEST READS UNTIL THE LIGHTING NAMES THE COLOUR ATLAS (`SceneTrace.maskReads`), once a device: a one-texel view for each lane, a zeroed page table, a
 * sampler, a one-record material table and a zeroed graph frame. No placement is flagged masked before the atlas is named (the cutouts are written together with it, `sceneMaskOf`), so no ray reads them; they let
 * every pass bind the scene trace whenever it exists.
 */
export const sceneMaskNone = oncePerDevice((device: GPUDevice): SceneMaskResources => {
  const views = PREVIEW_LAYOUT_NAMES.map((lane) =>
    arrayView(standInTexture(device, `Trillion3D scene mask none ${lane}`, 'rgba8unorm')),
  )
  const pages = standInBuffer(
    device,
    'Trillion3D scene mask none pages',
    NONE_PAGE_WORDS * 4,
    GPUBufferUsage.STORAGE,
  )
  return {
    color: { views, pages: { buffer: pages } },
    sampler: device.createSampler({ label: 'Trillion3D scene mask none sampler' }),
    table: arrayView(standInTexture(device, 'Trillion3D scene mask none records', 'rgba32uint')),
    frame: standInBuffer(
      device,
      'Trillion3D scene mask none graph frame',
      GRAPH_FRAME_BYTES,
      GPUBufferUsage.UNIFORM,
    ),
  }
})
