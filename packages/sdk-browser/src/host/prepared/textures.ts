/**
 * The host textures of the prepared scene, built from the texture table and the images the scene
 * tables locate, under the rules the host loader applied — since the scene the engine draws is
 * proven by being the same scene:
 *
 * - one host texture per image AND sampler rank: two table ranks naming both alike share it, and
 *   the rank it answers to is the first of them (the preview the sidecar bakes is found by it);
 * - one image decoded per image rank: a second texture of the same image is a copy sharing it;
 * - a slot reading another coordinate set, or declaring a transform, is a copy of its texture that
 *   keeps the texture's rank, the transform composed by the host from what the slot declares;
 * - colour maps are sRGB, the rest linear; rows are not flipped.
 */
import * as THREE from 'three';
import type { TableTextureSlot, TextureFilter, WrapMode } from '../../../../sdk-core/src/index.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';

const FILTERS: Record<TextureFilter, THREE.TextureFilter> = {
  nearest: THREE.NearestFilter,
  linear: THREE.LinearFilter,
  'nearest-mip-nearest': THREE.NearestMipmapNearestFilter,
  'linear-mip-nearest': THREE.LinearMipmapNearestFilter,
  'nearest-mip-linear': THREE.NearestMipmapLinearFilter,
  'linear-mip-linear': THREE.LinearMipmapLinearFilter,
};
const WRAPS: Record<WrapMode, THREE.Wrapping> = {
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
  repeat: THREE.RepeatWrapping,
};

/** The rank each built texture answers to, keyed by the texture: what the engine finds the baked
 *  preview of a texture by. */
export type TextureRanks = Map<THREE.Texture, number>;

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
  const sources = new Map<number, Promise<THREE.Texture | null>>();
  const folded = new Map<string, Promise<THREE.Texture | null>>();

  /** The texture holding image `rank`: the first request owns it, later ones copy it. */
  const source = (rank: number) => {
    const held = sources.get(rank);
    if (held) return held.then((texture) => texture?.clone() ?? null);
    const made = images(rank).then((image) => {
      if (image === null) return null;
      const texture = new THREE.Texture(image as TexImageSource);
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
        built.magFilter = FILTERS[declared.magFilter] as THREE.MagnificationTextureFilter;
        built.minFilter = FILTERS[declared.minFilter] as THREE.MinificationTextureFilter;
        built.wrapS = WRAPS[declared.wrapS];
        built.wrapT = WRAPS[declared.wrapT];
        built.generateMipmaps =
          built.minFilter !== THREE.NearestFilter && built.minFilter !== THREE.LinearFilter;
        ranks.set(built, rank);
        return built;
      });
      folded.set(key, texture);
    }
    return texture;
  };

  return async (slot: TableTextureSlot, colorSpace?: THREE.ColorSpace) => {
    let texture = await textureOf(slot.texture);
    if (!texture) return null;
    const { transform, texCoord } = slot;
    const moved =
      !!transform && (!!transform.offset || transform.rotation !== null || !!transform.scale);
    if (texCoord > 0 || moved) {
      const rank = ranks.get(texture);
      texture = texture.clone();
      texture.channel = texCoord;
      if (transform?.offset) texture.offset.fromArray(transform.offset);
      if (transform && transform.rotation !== null) texture.rotation = transform.rotation;
      if (transform?.scale) texture.repeat.fromArray(transform.scale);
      if (moved) texture.needsUpdate = true;
      if (rank !== undefined) ranks.set(texture, rank);
    }
    if (colorSpace) texture.colorSpace = colorSpace;
    return texture;
  };
}
