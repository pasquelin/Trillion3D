import type { Texture } from '../../../../../sdk-core/src/index.ts';
import type { VisMaterial } from '../../../visibility/types.ts';
import type { WebgpuTileStreamer } from '../../tile/streamer.ts';
import type { WebgpuPagesCore } from '../runtime.ts';
import { shadowsFollowTextures } from './lightResources.ts';

/** Each texture's filter, anisotropy and UV transform, in its atlas header (`../../tile/sampling.ts`),
 *  at the session's opening: sent with the tails. */
export function writeTextureSampling(
  textures: WebgpuTileStreamer,
  mapLayer: ReadonlyMap<Texture, number>,
  dataLayer: ReadonlyMap<Texture, number>,
) {
  for (const [texture, slot] of mapLayer) textures.color.pages.setSampling(slot, texture);
  for (const [texture, slot] of dataLayer) textures.data.pages.setSampling(slot, texture);
}

/** Colour slots whose sampling moved in one call of `followSurfaceSampling`: reused, never kept. */
const movedColor = new Set<number>();

/**
 * Writes the sampling of a surface's maps — filters, anisotropy, UV transform — into their atlas
 * headers and sends the words that moved (#360, #361). Called by the row writer at the first row
 * of each surface version (`../../row/pageRowConstants.ts`), where a moved version is already
 * detected: a filter or a placement written after the session opened — by a world repaint or by
 * the host on its own material — reaches the headers with the row that reads it. Nothing is
 * rebuilt: no pool, no sampler, no bind group. A cutout whose colour map moved has its cached
 * shadows redrawn (`shadowsFollowTextures`), as when one of its tiles lands.
 */
export function followSurfaceSampling(rt: WebgpuPagesCore, surface: VisMaterial) {
  const textures = rt.vis.textures;
  if (!textures) return;
  const { mapLayer, dataLayer } = rt.vis;
  /** The atlas slot of a map whose words moved, else 0. */
  const follow = (
    layers: ReadonlyMap<Texture, number>,
    atlas: typeof textures.color,
    texture: Texture | undefined,
  ) => {
    const slot = texture ? (layers.get(texture) ?? 0) : 0;
    return slot && atlas.pages.setSampling(slot, texture!) ? slot : 0;
  };
  for (const texture of [surface.map, surface.emissiveMap]) {
    const slot = follow(mapLayer, textures.color, texture);
    if (slot) movedColor.add(slot);
  }
  for (const texture of [
    surface.roughnessMap,
    surface.metalnessMap,
    surface.normalMap,
    surface.aoMap,
  ])
    follow(dataLayer, textures.data, texture);
  textures.flushTables();
  if (!movedColor.size) return;
  shadowsFollowTextures(rt.lights, rt.layout.rows, movedColor);
  movedColor.clear();
}
