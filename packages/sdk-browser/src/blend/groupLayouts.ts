import { oncePerDevice, oncePerDeviceKey } from '../gpu/core/oncePerDevice.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { grantsRectPictures } from '../gpu/core/rectPictures.ts'
import { objectShadowAtlasRead } from '../gpu/core/objectShadowRead.ts'
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

/**
 * THE SAME TWO LAYOUTS FOR A SESSION THAT READS ITS OBJECT'S SHADOW (the project switch `translucentObjectShadows`, `objectShadowAtlasRead`; `sorts`: the programs bind the sorted translucency's collect group besides): each holds besides the bindings of the read (the atlas where it is sampled and the packed table, `BLEND_OBJECT_SHADOW_BINDINGS`), in the group-0 layouts of those programs alone; the default layouts above stay as they were. None on a device that
 * grants the read neither sampled nor from the packed table.
 */
const objectShadowLayoutsOf = oncePerDeviceKey((device: GPUDevice, sorts: boolean) => {
  const read = objectShadowAtlasRead(device, sorts)
  if (!read) return undefined
  const layoutOf = (pictures: boolean) =>
    device.createBindGroupLayout({
      entries: blendLayoutEntries(BLEND_VIEW_SIZE, grantsVertexTextures(device), pictures, read),
    })
  const full = layoutOf(true)
  const pictures = grantsRectPictures(device)
  return { full, filtered: pictures ? full : layoutOf(false), pictures, read }
})

/** The group-0 layouts a session's blends are made on: the extended ones where it reads its object's shadow and the device grants it, else the default. */
export const blendLayoutsFor = (device: GPUDevice, objectShadow: boolean, sorts = false) =>
  (objectShadow ? objectShadowLayoutsOf(device, sorts) : undefined) ?? {
    ...blendGroupLayouts(device),
    read: undefined,
  }
