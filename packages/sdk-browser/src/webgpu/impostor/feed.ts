import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import { loadImpostorAtlas, type ImpostorAtlasLevels } from '../../impostor/atlas.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';
import { createWebgpuTileLevels } from '../tile/levels.ts';
import { textureBytesOf } from '../../gpu/core/textureBytes.ts';
import { deviceMade } from '../../gpu/core/errorScope.ts';

/** The three maps' formats: the colour is stored sRGB, the normal, depth and ORM linear. */
const MAP_FORMATS: Record<keyof ImpostorAtlasLevels, GPUTextureFormat> = {
  colourCoverage: 'rgba8unorm-srgb',
  normalDepth: 'rgba8unorm',
  orm: 'rgba8unorm',
};
const NAMES = Object.keys(MAP_FORMATS) as (keyof ImpostorAtlasLevels)[];

/** An atlas whose levels the browser decoded, as every lossless level is. */
type DecodedAtlas = Record<keyof ImpostorAtlasLevels, ImageBitmap[]>;
type Fed = { group?: GPUBindGroup; textures: GPUTexture[]; bytes: number; drawn: number };

/** The texture of one map, its whole mip chain, as the feed allocates it. */
const mapTexture = (maps: ImpostorMaps, name: keyof ImpostorAtlasLevels, key: string) => {
  const [first] = maps[name].levels;
  return {
    label: `Trillion3D impostor ${name} ${key}`,
    size: [first.width, first.height],
    mipLevelCount: maps[name].levels.length,
    format: MAP_FORMATS[name],
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  } satisfies GPUTextureDescriptor;
};

/** GPU bytes of a mesh's atlas, its three chains, read from its maps before any level is. */
const atlasBytes = (maps: ImpostorMaps) =>
  NAMES.reduce((sum, name) => sum + (textureBytesOf(mapTexture(maps, name, '')) ?? 0), 0);

/**
 * THE PER-MESH ATLAS FEED (#1335): each baked mesh's three maps, read through the one held-level
 * read the tiles use (`impostor/atlas.ts`), copied once into three textures with their mips under
 * the device's out-of-memory scope (`deviceMade`), and bound in one group (`layout`, group 1 of the
 * card pass). Its bytes are texture memory held beside the texture pool, within the one texture
 * budget (`textureBytesBeside`): `room` is what that budget leaves them, and the pool is drawn
 * again without them as they change. An atlas past the room is not read; within it the
 * atlases drawn least recently leave first, one the frame draws never. Until its group exists,
 * `group` answers nothing and the root keeps its clusters — never a hole. `landed` is told when
 * levels land or an atlas is made, so a held image is drawn again.
 */
export function createImpostorFeed(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  reader: TextureLevelReader,
  options: {
    room: () => number;
    landed: () => void;
    onFailure: (phase: string, error: unknown) => void;
  },
) {
  const { room, landed, onFailure } = options;
  const levels = createWebgpuTileLevels({
    read: reader,
    onFailure: (key, error) => onFailure(`impostor-level-read-failed ${key.sha256}`, error),
  });
  const sampler = device.createSampler({
    label: 'Trillion3D impostor atlas',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  // Keyed by mesh number as text, in recency order: a group read re-inserts its mesh.
  const fed = new Map<string, Fed>();
  // Meshes whose atlas the device refused, each with the feed's bytes then: asked again only once
  // the feed holds less.
  const refused = new Map<string, number>();
  // Each mesh's atlas bytes, read once from its maps: a streaming mesh asks every image.
  const sizes = new Map<string, number>();
  let watching = false,
    closed = false;
  const drop = (key: string) => {
    const entry = fed.get(key);
    fed.delete(key);
    if (!entry) return;
    feed.bytes -= entry.bytes;
    for (const texture of entry.textures) texture.destroy();
  };
  /** Frees the room `bytes` needs, the atlases drawn least recently first; false if it cannot. */
  const fits = (key: string, bytes: number, frame: number) => {
    evictOldest(
      fed.keys(),
      () => feed.bytes + bytes > room(),
      (other) => {
        const held = fed.get(other)!;
        return other === key || !held.group || held.drawn === frame;
      },
      drop,
    );
    return feed.bytes + bytes <= room();
  };
  /** Copies the three chains into textures under the out-of-memory scope, then binds them. */
  const upload = (key: string, maps: ImpostorMaps, atlas: DecodedAtlas, bytes: number) => {
    const entry: Fed = { textures: [], bytes, drawn: -1 };
    fed.set(key, entry);
    feed.bytes += bytes;
    const make = () => {
      const textures: GPUTexture[] = [];
      const destroy = () => textures.forEach((texture) => texture.destroy());
      try {
        for (const name of NAMES) {
          const texture = device.createTexture(mapTexture(maps, name, key));
          textures.push(texture);
          atlas[name].forEach((level, mipLevel) =>
            device.queue.copyExternalImageToTexture({ source: level }, { texture, mipLevel }, [
              level.width,
              level.height,
            ]),
          );
        }
      } catch (error) {
        destroy();
        throw error;
      }
      return { textures, destroy };
    };
    // A copy that throws (a level the store released) frees the entry: the mesh keeps its
    // clusters and is asked again, its bytes no longer held.
    const failed = (error: unknown) => {
      if (fed.get(key) === entry) drop(key);
      if (!closed) onFailure('impostor-atlas-upload-failed', error);
    };
    void deviceMade(device, make).then((made) => {
      if (closed || fed.get(key) !== entry) return made?.destroy();
      if (!made) {
        drop(key);
        refused.set(key, feed.bytes);
        return onFailure('gpu-out-of-memory', new Error(`impostor atlas ${key}: ${bytes} bytes`));
      }
      entry.textures = made.textures;
      entry.group = device.createBindGroup({
        label: `Trillion3D impostor atlas ${key}`,
        layout,
        entries: [
          ...made.textures.map((texture, binding) => ({ binding, resource: texture.createView() })),
          { binding: 3, resource: sampler },
        ],
      });
      landed();
    }, failed);
  };
  const feed = {
    /** GPU bytes of the atlases held, those being made included. */
    bytes: 0,
    /** The group of `mesh`'s atlas, marked drawn at `frame`; absent until it is made, its levels
     *  read the first frames it is asked and fits. A refused or failed read leaves the mesh to its
     *  clusters, and is asked again; an atlas the device refused, once the feed holds less. */
    group(mesh: number, maps: ImpostorMaps, frame: number) {
      const key = String(mesh);
      const entry = fed.get(key);
      if (entry) {
        fed.delete(key);
        fed.set(key, entry);
        if (entry.group) entry.drawn = frame;
        return entry.group;
      }
      // An atlas past the whole room is never read: it would not fit even alone.
      let bytes = sizes.get(key);
      if (bytes === undefined) sizes.set(key, (bytes = atlasBytes(maps)));
      if (closed || bytes > room() || feed.bytes >= (refused.get(key) ?? Infinity))
        return undefined;
      refused.delete(key);
      const atlas = loadImpostorAtlas(maps, levels, frame);
      if (atlas === 'waiting' && !watching) {
        watching = true;
        void levels.settled().then(() => {
          watching = false;
          if (!closed) landed();
        });
      }
      if (typeof atlas === 'string') return undefined;
      if (NAMES.some((name) => atlas[name].some((level) => level instanceof Uint8Array)))
        return undefined;
      if (!fits(key, bytes, frame)) return undefined;
      upload(key, maps, atlas as DecodedAtlas, bytes);
      return undefined;
    },
    dispose() {
      closed = true;
      for (const key of [...fed.keys()]) drop(key);
      levels.destroy();
    },
  };
  return feed;
}
