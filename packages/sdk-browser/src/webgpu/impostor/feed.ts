import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import type { ImpostorAtlasLevels } from '../../impostor/atlas.ts';
import {
  ATLAS_MAPS,
  createAtlasFeed,
  type AtlasFeedOptions,
  type DecodedAtlas,
  type FedAtlas,
} from '../../impostor/feed.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { textureBytesOf } from '../../gpu/core/textureBytes.ts';
import { deviceMade } from '../../gpu/core/errorScope.ts';

/** The three maps' formats: the colour is stored sRGB, the normal, depth and ORM linear. */
const MAP_FORMATS: Record<keyof ImpostorAtlasLevels, GPUTextureFormat> = {
  colourCoverage: 'rgba8unorm-srgb',
  normalDepth: 'rgba8unorm',
  orm: 'rgba8unorm',
};

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
  ATLAS_MAPS.reduce((sum, name) => sum + (textureBytesOf(mapTexture(maps, name, '')) ?? 0), 0);

/**
 * THE PER-MESH ATLAS FEED on WebGPU (#1335): the shared feed (`impostor/feed.ts`), each atlas
 * copied once into three textures with their mips under the device's out-of-memory scope
 * (`deviceMade`), and bound in one group (`layout`, group 1 of the card pass). Its bytes are
 * texture memory held beside the texture pool, within the one texture budget
 * (`textureBytesBeside`). `landed` is told too when an atlas is made, so a held image is drawn
 * again.
 */
export function createImpostorFeed(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  reader: TextureLevelReader,
  options: AtlasFeedOptions,
) {
  const { landed, onFailure } = options;
  const sampler = device.createSampler({
    label: 'Trillion3D impostor atlas',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  /** Copies the three chains into textures under the out-of-memory scope, then binds them. */
  const make = (
    key: string,
    maps: ImpostorMaps,
    atlas: DecodedAtlas,
    entry: FedAtlas<GPUBindGroup>,
  ) => {
    const copy = () => {
      const textures: GPUTexture[] = [];
      const destroy = () => textures.forEach((texture) => texture.destroy());
      try {
        for (const name of ATLAS_MAPS) {
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
      if (feed.holds(key, entry)) feed.drop(key);
      if (!feed.closed) onFailure('impostor-atlas-upload-failed', error);
    };
    void deviceMade(device, copy).then((made) => {
      if (!feed.holds(key, entry)) return made?.destroy();
      if (!made) {
        feed.refuse(key);
        return onFailure(
          'gpu-out-of-memory',
          new Error(`impostor atlas ${key}: ${entry.bytes} bytes`),
        );
      }
      entry.release = made.destroy;
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
  const feed = createAtlasFeed<GPUBindGroup>(reader, { ...options, bytesOf: atlasBytes, make });
  return feed;
}
