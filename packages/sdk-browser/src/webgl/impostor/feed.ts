import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import {
  ATLAS_MAPS,
  createAtlasFeed,
  type AtlasFeedOptions,
  type DecodedAtlas,
  type FedAtlas,
} from '../../impostor/feed.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { allocated } from '../core/allocation.ts';
import { SUBSURFACE_UNIT } from '../cluster/materialMaps.ts';
import { sentBytes } from '../cluster/sentBytes.ts';

/** The units of the card records and of the three atlas maps: past every unit the cluster program
 *  binds (`setClusterSamplers`, the subsurface map last), so a card draw leaves its bindings as
 *  they were. */
export const CARD_RECORD_UNIT = SUBSURFACE_UNIT + 1;
export const ATLAS_UNITS = [CARD_RECORD_UNIT + 1, CARD_RECORD_UNIT + 2, CARD_RECORD_UNIT + 3];

/** A mesh's atlas on WebGL2: its three textures, in `ATLAS_MAPS` order. */
export type WebglAtlas = readonly WebGLTexture[];

/** Bytes of a mesh's atlas, its three RGBA8 chains, read from its maps before any level is. */
const atlasBytes = (maps: ImpostorMaps) =>
  ATLAS_MAPS.reduce(
    (sum, name) =>
      maps[name].levels.reduce((bytes, { width, height }) => bytes + sentBytes(width, height), sum),
    0,
  );

/**
 * THE PER-MESH ATLAS FEED on WebGL2 (#1336): the shared feed (`impostor/feed.ts`), the same reads,
 * room and order as WebGPU's, each atlas copied once into three immutable textures with their
 * whole mip chain — the colour stored sRGB, the normal, depth and ORM linear, sampled linearly
 * between mips and clamped at the edge as the WebGPU sampler does. A refused allocation is read at
 * a later frame (`allocated`, `../core/allocation.ts`): the atlas then leaves and is asked again
 * once the feed holds less; a copy that throws frees it at once. Either is reported.
 */
export function createWebglImpostorFeed(
  gl: WebGL2RenderingContext,
  reader: TextureLevelReader,
  options: AtlasFeedOptions,
) {
  const { onFailure } = options;
  const make = (
    key: string,
    _maps: ImpostorMaps,
    atlas: DecodedAtlas,
    entry: FedAtlas<WebglAtlas>,
  ) => {
    const textures: WebGLTexture[] = [];
    entry.release = () => textures.forEach((texture) => gl.deleteTexture(texture));
    try {
      ATLAS_MAPS.forEach((name, map) => {
        const levels = atlas[name],
          texture = gl.createTexture()!;
        textures.push(texture);
        gl.activeTexture(gl.TEXTURE0 + ATLAS_UNITS[map]);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const format = map === 0 ? gl.SRGB8_ALPHA8 : gl.RGBA8;
        gl.texStorage2D(gl.TEXTURE_2D, levels.length, format, levels[0].width, levels[0].height);
        levels.forEach((level, mip) =>
          gl.texSubImage2D(gl.TEXTURE_2D, mip, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, level),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      });
    } catch (error) {
      // A level the store released: the mesh keeps its clusters and is asked again.
      feed.drop(key);
      return onFailure('impostor-atlas-upload-failed', error);
    }
    allocated(gl, 'texture', () => {
      if (!feed.holds(key, entry)) return;
      feed.refuse(key);
      onFailure('gpu-out-of-memory', new Error(`impostor atlas ${key}: ${entry.bytes} bytes`));
    });
    entry.group = textures;
  };
  const feed = createAtlasFeed<WebglAtlas>(reader, { ...options, bytesOf: atlasBytes, make });
  return feed;
}
