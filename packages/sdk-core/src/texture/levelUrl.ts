import { EngineError } from '../contracts/cache.ts'
import {
  PREVIEW_HALF_FILE,
  PREVIEW_LAYOUT_FILES,
  previewAtlasName,
  type TextureBlockFormat,
  type StoredLayout,
} from './previewFormat.ts'

/** What a level file holds: the blocks of one family in one layout, or the half-float texels of
 *  the half-float atlas. */
export type TextureLevelFormat =
  | {
      [
        F in TextureBlockFormat
      ]: (typeof PREVIEW_LAYOUT_FILES)[F][keyof (typeof PREVIEW_LAYOUT_FILES)[F]]
    }[TextureBlockFormat]
  | typeof PREVIEW_HALF_FILE

/** The level file a chain's layout in a family names; a family that holds nothing of it names
 *  none. */
export function textureLevelFormat(
  family: TextureBlockFormat,
  layout: StoredLayout,
): TextureLevelFormat {
  const files: Partial<Record<StoredLayout, string>> = PREVIEW_LAYOUT_FILES[family]
  const file = files[layout] as TextureLevelFormat | undefined
  if (!file)
    throw new EngineError('INVALID_CACHE', 'A texture level names a family that holds no chain', {
      family,
      layout,
    })
  return file
}

/**
 * Address of a baked level, from the template the manifest publishes (`textures.url`): `{sha}`
 * is the chain's fingerprint (the image source bytes' digest and the sheet that decides them),
 * `{kind}` the atlas name, `{level}` the level rank, `{format}` the file's encoding. The template
 * comes from the compiler and the engine does not know the cache layout; one truth, as for pages.
 * A template without its four fields is rejected: an address that does not vary with them would
 * serve the same image to every texture.
 */
export function textureLevelUrl(
  template: string,
  sha256: string,
  atlas: number,
  level: number,
  format: TextureLevelFormat,
) {
  const kind = previewAtlasName(atlas)
  if (kind === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture level names an unknown atlas', { atlas })
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(level) || level < 0)
    throw new EngineError('INVALID_CACHE', 'A texture level has an invalid address', {
      sha256,
      level,
    })
  for (const field of ['{sha}', '{kind}', '{level}', '{format}'])
    if (!template.includes(field))
      throw new EngineError('INVALID_CACHE', 'The texture level template lacks a field', {
        template,
        field,
      })
  return template
    .replace('{sha}', sha256)
    .replace('{kind}', kind)
    .replace('{level}', String(level))
    .replace('{format}', format)
}
