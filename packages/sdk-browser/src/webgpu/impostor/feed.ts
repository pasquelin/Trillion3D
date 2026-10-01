import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import { loadImpostorAtlas, type ImpostorAtlasLevels } from '../../impostor/atlas.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';

/**
 * The atlas budget: the GPU bytes every resident card atlas holds together, fixed and never read
 * from the machine (CONTRIBUTING, Streaming rule 5), as the reference streams its impostor and
 * HLOD textures into a pool of fixed size. Sixty-four mebibytes hold about twenty 2048² atlases
 * of three maps with their mips: a forest's species, not one per placement.
 */
const IMPOSTOR_ATLAS_BUDGET_BYTES = 64 * 1024 * 1024;

/** The three maps' formats: the colour is stored sRGB, the normal, depth and ORM linear. */
const MAP_FORMATS: Record<keyof ImpostorAtlasLevels, GPUTextureFormat> = {
  colourCoverage: 'rgba8unorm-srgb',
  normalDepth: 'rgba8unorm',
  orm: 'rgba8unorm',
};

type Fed = { group?: GPUBindGroup; textures: GPUTexture[]; bytes: number; drawn: number };

/** GPU bytes of one map's chain: four bytes a texel at every level. */
const chainBytes = (levels: { width: number; height: number }[]) =>
  levels.reduce((sum, level) => sum + level.width * level.height * 4, 0);

/**
 * THE PER-MESH ATLAS FEED (#1335): each baked mesh's three maps, read through the engine's one
 * level reader and store (`impostor/atlas.ts`), copied once into three textures with their mips
 * and bound in one group (`layout`, group 1 of the card pass). A mesh is fed the first time its
 * card is planned; until its group exists, `group` answers nothing and the root keeps its
 * clusters — never a hole. Within the budget, the atlases drawn least recently leave first; one a
 * frame draws never leaves during it. `landed` is told when an atlas lands, so a held image is
 * drawn again.
 */
export function createImpostorFeed(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  reader: TextureLevelReader,
  landed: () => void,
  budgetBytes = IMPOSTOR_ATLAS_BUDGET_BYTES,
) {
  const sampler = device.createSampler({
    label: 'Trillion3D impostor atlas',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  // Keyed by mesh number as text, in recency order: a group read re-inserts its mesh.
  const fed = new Map<string, Fed>();
  let frame = 0,
    closed = false;
  const drop = (key: string) => {
    const entry = fed.get(key);
    fed.delete(key);
    if (!entry) return;
    feed.bytes -= entry.bytes;
    for (const texture of entry.textures) texture.destroy();
  };
  /** Copies the three chains into textures and binds them; refuses an atlas past the budget. */
  const upload = (key: string, atlas: ImpostorAtlasLevels) => {
    const entry = fed.get(key);
    if (closed || !entry) return;
    const names = Object.keys(MAP_FORMATS) as (keyof ImpostorAtlasLevels)[];
    if (names.some((name) => atlas[name].some((level) => level instanceof Uint8Array))) return;
    const levels = atlas as Record<keyof ImpostorAtlasLevels, ImageBitmap[]>;
    const bytes = names.reduce((sum, name) => sum + chainBytes(levels[name]), 0);
    evictOldest(
      fed.keys(),
      () => feed.bytes + bytes > budgetBytes,
      (other) => other === key || !fed.get(other)!.group || fed.get(other)!.drawn === frame,
      drop,
    );
    if (feed.bytes + bytes > budgetBytes) return;
    for (const name of names) {
      const chain = levels[name];
      const texture = device.createTexture({
        label: `Trillion3D impostor ${name} ${key}`,
        size: [chain[0].width, chain[0].height],
        mipLevelCount: chain.length,
        format: MAP_FORMATS[name],
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      entry.textures.push(texture);
      chain.forEach((level, mipLevel) =>
        device.queue.copyExternalImageToTexture({ source: level }, { texture, mipLevel }, [
          level.width,
          level.height,
        ]),
      );
    }
    entry.bytes = bytes;
    feed.bytes += bytes;
    entry.group = device.createBindGroup({
      label: `Trillion3D impostor atlas ${key}`,
      layout,
      entries: [
        ...entry.textures.map((texture, binding) => ({ binding, resource: texture.createView() })),
        { binding: 3, resource: sampler },
      ],
    });
    landed();
  };
  const feed = {
    /** GPU bytes of the resident atlases. */
    bytes: 0,
    /** Opens the image's frame: the atlases it draws are kept until the next one. */
    beginFrame() {
      frame++;
    },
    /** The group of `mesh`'s atlas, marked drawn this frame; absent until it lands, and its read
     *  is asked the first time. A read that fails leaves the mesh to its clusters. */
    group(mesh: number, maps: ImpostorMaps) {
      const key = String(mesh);
      const entry = fed.get(key);
      if (entry) {
        fed.delete(key);
        fed.set(key, entry);
        if (entry.group) entry.drawn = frame;
        return entry.group;
      }
      fed.set(key, { textures: [], bytes: 0, drawn: frame });
      loadImpostorAtlas(maps, reader, (atlas) => upload(key, atlas)).catch(() => undefined);
      return undefined;
    },
    dispose() {
      closed = true;
      for (const key of [...fed.keys()]) drop(key);
    },
  };
  return feed;
}
