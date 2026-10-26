import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { joinTexture } from '../../lighting/lightFunction/maps.ts'
import type { FogAtlas } from '../../lighting/fog/voxelGraph.ts'
import type { VoxelGraphMaps } from '../../lighting/fog/voxelGpu.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** A level of a texture finer than any it has: asks the texture at its full detail. */
const FULL_DETAIL = 2 ** 30

/** How the volume's voxelisation refuses a texture its graphs read (`joinTexture`). */
const REFUSAL = {
  code: 'fog-graph-texture-refused',
  message: 'A texture a fog volume graph reads was refused',
}

/** The maps of each runtime, made once. */
const made = new WeakMap<WebgpuPagesRuntime, VoxelGraphMaps>()

/**
 * What the voxelisation of the graphs reads of the colour atlas (`VoxelGraphMaps`): a texture's slot,
 * the atlas's pools, page table and sampler where it is there, and the textures the graphs read taken
 * into the atlas — within its budget — and asked at their full detail: the voxelisation has no
 * feedback of its own to ask the tiles its cells read, and a volume's textures (a noise) are small.
 */
export function fogGraphMaps(rt: WebgpuPagesRuntime): VoxelGraphMaps {
  let maps = made.get(rt)
  if (maps) return maps
  maps = {
    slotOf: (texture) => rt.vis.mapLayer.get(texture as never),
    atlas(): FogAtlas | undefined {
      const atlas = rt.vis.textures?.color,
        sampler = rt.vis.mapsSampler
      return atlas && sampler
        ? { views: atlas.views, pages: atlas.pages.buffer, sampler }
        : undefined
    },
    warm(textures: readonly Texture[]) {
      for (const texture of textures) {
        const place = rt.vis.mapLayer.get(texture as never)
        if (place === undefined) joinTexture(rt, texture, REFUSAL)
        else rt.vis.textures?.warm('color', place, FULL_DETAIL, rt.run.frame)
      }
    },
  }
  made.set(rt, maps)
  return maps
}
