import { readGpuImage } from '../../../gpu/core/presentation.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

import type { Texture } from '../../../../../sdk-core/src/index.ts';
import type { PageSurface } from '../../../page/surface.ts';

/** Which pass reads a texture: the opaque resolve, its alpha-tested (mask) branch, or the blend. */
export type SurfaceKind = 'opaque' | 'mask' | 'blend';
type Count = { requested: number; atLevel: number };
type Region = Count & {
  pixels: number;
  mips: Record<string, number>;
  kinds: Record<SurfaceKind, Count>;
};
export type SpatialFeedback = { center: Region; periphery: Region };
type Atlases = NonNullable<WebgpuPagesRuntime['vis']['textures']>;

/** Blend wins over mask over opaque for a texture several surfaces share. */
function textureKinds(rt: Pick<WebgpuPagesRuntime, 'setup'>) {
  const kinds = new Map<Texture, SurfaceKind>();
  const mark = (s: PageSurface, kind: SurfaceKind) => {
    for (const map of [s.map, s.emissiveMap, s.roughnessMap, s.metalnessMap, s.normalMap, s.aoMap])
      if (map && kinds.get(map) !== 'blend' && (kind !== 'opaque' || !kinds.has(map)))
        kinds.set(map, kind);
  };
  for (const rec of rt.setup.allPages)
    mark(rec.material, rec.transparent ? 'blend' : rec.material.alphaTest > 0 ? 'mask' : 'opaque');
  for (const copy of rt.setup.blendCopies) mark(copy.surface, 'blend');
  return (texture: Texture | undefined): SurfaceKind => (texture && kinds.get(texture)) || 'opaque';
}

function spatialMipCounts(
  ranks: Uint32Array,
  width: number,
  height: number,
  textures: Atlases,
  kindOf: (texture: Texture | undefined) => SurfaceKind = () => 'opaque',
): SpatialFeedback {
  const count = (): Count => ({ requested: 0, atLevel: 0 });
  const region = (): Region => ({
    ...count(),
    pixels: 0,
    mips: {},
    kinds: { opaque: count(), mask: count(), blend: count() },
  });
  const result: SpatialFeedback = { center: region(), periphery: region() };
  // Eight-by-eight patches cover 1/16 feedback phases and map picks; Y flip keeps the bands symmetric.
  for (let gy = 0; gy < 9; gy++)
    for (let gx = 0; gx < 16; gx++) {
      const group = gx >= 4 && gx < 12 && gy >= 2 && gy < 7 ? result.center : result.periphery;
      for (let dy = 0; dy < 8; dy++)
        for (let dx = 0; dx < 8; dx++) {
          const x = Math.floor(((gx + 0.5) * width) / 16) - 4 + dx,
            y = Math.floor(((gy + 0.5) * height) / 9) - 4 + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          group.pixels++;
          const rank = ranks[y * width + x];
          if (!rank) continue;
          const index = rank - 1;
          if (index >= textures.color.pages.entries + textures.data.pages.entries)
            throw new Error('FEEDBACK_AB_SPATIAL_RANK_INVALID');
          const atlas = index < textures.color.pages.entries ? textures.color : textures.data;
          const key = atlas.pages.tileOf(index);
          const served = atlas.servedLevel(key);
          const kind = group.kinds[kindOf(atlas.textures[key.slot]?.texture)];
          group.requested++;
          kind.requested++;
          const pair = `${key.level}->${served}`;
          group.mips[pair] = (group.mips[pair] ?? 0) + 1;
          if (served !== key.level) continue;
          group.atLevel++;
          kind.atLevel++;
        }
    }
  return result;
}

/** Scene-level mip evidence from the last submitted r32uint feedback image. */
export async function feedbackAbSpatial(rt: WebgpuPagesRuntime): Promise<SpatialFeedback> {
  const device = rt.gpu.device,
    target = rt.gpu.feedbackTexture,
    textures = rt.vis.textures;
  if (!rt.feedbackAB?.target || !device || !target || !textures)
    throw new Error('FEEDBACK_AB_SPATIAL_UNAVAILABLE');
  const [width, height] = rt.gpu.targetSize;
  if (!width || !height || !rt.run.imageRevision) throw new Error('FEEDBACK_AB_IMAGE_MISSING');
  const bytes = await readGpuImage(device, target, width, height, rt.signal);
  return spatialMipCounts(
    new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
    width,
    height,
    textures,
    textureKinds(rt),
  );
}
