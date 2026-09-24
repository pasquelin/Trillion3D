/**
 * The host textures of the prepared scene, built from the texture table and the images the scene
 * tables locate, under the rules the host loader applied — since the scene the engine draws is
 * proven by being the same scene:
 *
 * - one host texture per image AND sampler rank: two table ranks naming both alike share it, and
 *   the rank it answers to is the first of them (the preview the sidecar bakes is found by it);
 * - one image decoded per image rank: a second texture of the same image is a copy sharing it;
 * - a slot reading another coordinate set, or declaring a transform, is a copy of its texture —
 *   the transform composed by the host from what the slot declares — and only a copy on the
 *   first coordinate set keeps the texture's rank;
 * - colour maps are sRGB, the rest linear; rows are not flipped.
 */
import type { TableTextureSlot, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { GraphTexture } from '../graph/texture.ts';
import {
  HOST_FILTER_LINEAR,
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
  HOST_WRAP_REPEAT,
} from '../surfaceConstants.ts';

const FILTERS: Record<TextureFilter, number> = {
  nearest: HOST_FILTER_NEAREST,
  linear: HOST_FILTER_LINEAR,
  'nearest-mip-nearest': HOST_FILTER_NEAREST_MIP_NEAREST,
  'linear-mip-nearest': HOST_FILTER_LINEAR_MIP_NEAREST,
  'nearest-mip-linear': HOST_FILTER_NEAREST_MIP_LINEAR,
  'linear-mip-linear': HOST_FILTER_LINEAR_MIP_LINEAR,
};
const WRAPS: Record<WrapMode, number> = {
  clamp: HOST_WRAP_CLAMP_TO_EDGE,
  mirror: HOST_WRAP_MIRRORED_REPEAT,
  repeat: HOST_WRAP_REPEAT,
};

/** The rank each built texture answers to, keyed by the texture: what the engine finds the baked
 *  preview of a texture by. */
export type TextureRanks = Map<GraphTexture, number>;

/**
 * The textures of `tables` for the images of `document`: `slot` resolves a material's map slot
 * to its host texture, or `null` when its image could not be read.
 */
export function preparedTextures(
  tables: PreparedSceneTables,
  document: TableDocument,
  images: (rank: number) => Promise<unknown>,
  ranks: TextureRanks,
) {
  const sources = new Map<number, Promise<GraphTexture | null>>();
  const folded = new Map<string, Promise<GraphTexture | null>>();

  /** The texture holding image `rank`: the first request owns it, later ones copy it. */
  const source = (rank: number) => {
    const held = sources.get(rank);
    if (held) return held.then((texture) => texture?.clone() ?? null);
    const made = images(rank).then((image) => {
      if (image === null) return null;
      const texture = new GraphTexture(image);
      texture.needsUpdate = true;
      return texture;
    });
    sources.set(rank, made);
    return made;
  };

  const textureOf = (rank: number) => {
    const declared = tables.textures[rank];
    const image = declared?.image == null ? undefined : document.images[declared.image];
    if (!image) return Promise.resolve(null);
    const key = `${image.uri || image.view}:${declared.sampler ?? undefined}`;
    let texture = folded.get(key);
    if (!texture) {
      texture = source(declared.image!).then((built) => {
        if (!built) return null;
        built.flipY = false;
        built.name = declared.name || image.name || '';
        if (!built.name && image.uri !== null && !image.uri.startsWith('data:image/'))
          built.name = image.uri;
        built.magFilter = FILTERS[declared.magFilter];
        built.minFilter = FILTERS[declared.minFilter];
        built.wrapS = WRAPS[declared.wrapS];
        built.wrapT = WRAPS[declared.wrapT];
        built.generateMipmaps =
          built.minFilter !== HOST_FILTER_NEAREST && built.minFilter !== HOST_FILTER_LINEAR;
        ranks.set(built, rank);
        return built;
      });
      folded.set(key, texture);
    }
    return texture;
  };

  return async (slot: TableTextureSlot, colorSpace?: string) => {
    let texture = await textureOf(slot.texture);
    if (!texture) return null;
    const { transform, texCoord, slotTexCoord } = slot;
    const moved =
      !!transform && (!!transform.offset || transform.rotation !== null || !!transform.scale);
    // The loader's two steps: a slot naming another set than the first reads a copy of the
    // texture; a transform that moves the coordinates, or names another set again, a copy of that.
    if (slotTexCoord > 0 || moved || texCoord !== slotTexCoord) {
      const rank = ranks.get(texture);
      texture = texture.clone();
      texture.channel = texCoord;
      if (transform?.offset) texture.offset.set(transform.offset[0], transform.offset[1]);
      if (transform && transform.rotation !== null) texture.rotation = transform.rotation;
      if (transform?.scale) texture.repeat.set(transform.scale[0], transform.scale[1]);
      if (moved) texture.needsUpdate = true;
      // A copy made for the slot's own set answers to no rank, as the loader published none for
      // it; a copy the transform alone made keeps its texture's, whatever set it then reads.
      if (rank !== undefined && slotTexCoord === 0) ranks.set(texture, rank);
    }
    if (colorSpace) texture.colorSpace = colorSpace;
    return texture;
  };
}
