import { EngineError } from './cacheContracts.ts';
import {
  PREVIEW_ATLAS_NAMES,
  PREVIEW_LAYOUT_FILES,
  PREVIEW_LOSSLESS_FORMAT,
  type TextureBlockFormat,
  type TextureLayout,
} from './manifestBinaryFormat.ts';

/** What a level file holds: the lossless PNG, or the blocks of one family in one layout. */
export type TextureLevelFormat =
  | typeof PREVIEW_LOSSLESS_FORMAT
  | (typeof PREVIEW_LAYOUT_FILES)[TextureBlockFormat][Exclude<TextureLayout, 'lossless'>];

/** The level file a chain's layout in a family names: the lossless one when it kept none. */
export function textureLevelFormat(
  family: TextureBlockFormat | undefined,
  layout: TextureLayout,
): TextureLevelFormat {
  return family === undefined || layout === 'lossless'
    ? PREVIEW_LOSSLESS_FORMAT
    : PREVIEW_LAYOUT_FILES[family][layout];
}

/**
 * Address of a baked level, from the template the manifest publishes (`textures.url`): `{sha}`
 * is the digest of the image source bytes, `{kind}` the atlas name, `{level}` the level
 * rank, `{format}` the file's encoding. The template comes from the compiler and the engine does
 * not know the cache layout; one truth, as for pages. A template without its four fields is
 * rejected: an address that does not vary with them would serve the same image to every texture.
 */
export function textureLevelUrl(
  template: string,
  sha256: string,
  atlas: number,
  level: number,
  format: TextureLevelFormat,
) {
  const kind = PREVIEW_ATLAS_NAMES[atlas];
  if (kind === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture level names an unknown atlas', { atlas });
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(level) || level < 0)
    throw new EngineError('INVALID_CACHE', 'A texture level has an invalid address', {
      sha256,
      level,
    });
  for (const field of ['{sha}', '{kind}', '{level}', '{format}'])
    if (!template.includes(field))
      throw new EngineError('INVALID_CACHE', 'The texture level template lacks a field', {
        template,
        field,
      });
  return template
    .replace('{sha}', sha256)
    .replace('{kind}', kind)
    .replace('{level}', String(level))
    .replace('{format}', format);
}
