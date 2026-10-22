import { retire } from '../../gpu/core/frameRetire.ts'
import { ATLAS_TEXTURE_FORMAT } from './layout.ts'
import type { AtlasShape, LightFunctionPlan } from './plan.ts'

/** The atlas's texture and the table last written under its slots. */
export interface AtlasTexture {
  readonly device: GPUDevice
  texture?: GPUTexture
  view?: GPUTextureView
  shape?: AtlasShape
  rows: number
  table?: Float32Array
}

export const createAtlasTexture = (device: GPUDevice): AtlasTexture => ({ device, rows: 0 })

const sameShape = (a: AtlasShape | undefined, b: AtlasShape) =>
  !!a && a.edge === b.edge && a.slot === b.slot

/**
 * Fits the texture and the table to the plan. The texture grows with the table, never shrinks; a new
 * one is `fresh` (every slot is drawn), a table written is `wrote`.
 */
export function fitAtlasTexture(atlas: AtlasTexture, plan: LightFunctionPlan, at: AtlasShape) {
  const { device } = atlas
  let fresh = false
  if (!atlas.texture || !sameShape(atlas.shape, at) || plan.rows > atlas.rows) {
    if (atlas.texture) retire(device, atlas.texture)
    atlas.rows = plan.rows
    atlas.texture = device.createTexture({
      label: 'Trillion3D light function atlas',
      size: [at.side, at.side + atlas.rows],
      format: ATLAS_TEXTURE_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    })
    atlas.view = atlas.texture.createView()
    atlas.table = undefined
    fresh = true
  }
  atlas.shape = at
  const { table } = atlas
  const wrote =
    !table || table.length !== plan.table.length || table.some((v, i) => v !== plan.table[i])
  if (wrote) {
    device.queue.writeTexture(
      { texture: atlas.texture!, origin: [0, at.side] },
      plan.table,
      { bytesPerRow: at.side * 16 },
      [at.side, plan.rows],
    )
    atlas.table = plan.table
  }
  return { fresh, wrote }
}
