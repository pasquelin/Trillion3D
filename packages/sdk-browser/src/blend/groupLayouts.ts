import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { grantsRectPictures } from '../gpu/core/rectPictures.ts'
import { grantsVertexTextures } from '../gpu/core/vertexTextures.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'

/**
 * THE BLEND GROUP'S TWO LAYOUTS (group 0), made by one builder once a device: `full`, which every blend pipeline draws on and which holds the
 * rectangle lights' pictures (`BLEND_RECT_BINDINGS`), and `filtered`, the layout of the pipelines of an image with display layers, which
 * bind the display mask in a group of their own besides (`DISPLAY_MASK_GROUP`). The pictures are the seventeenth sampled texture of those
 * pipelines' fragment stage, so `filtered` holds them only on a device that grants it (`grantsRectPictures`); on a device that grants sixteen
 * it is the layout without them, and those pipelines light a rectangle plain (`pictures` false). Else the two are one layout.
 */
export const blendGroupLayouts = oncePerDevice((device: GPUDevice) => {
  const layoutOf = (pictures: boolean) =>
    device.createBindGroupLayout({
      entries: blendLayoutEntries(BLEND_VIEW_SIZE, grantsVertexTextures(device), pictures),
    })
  const full = layoutOf(true)
  const pictures = grantsRectPictures(device)
  return { full, filtered: pictures ? full : layoutOf(false), pictures }
})
