/**
 * THE IMPOSTOR ATLAS, streamed like any texture (#1239, fact 3). Each level of an atlas map carries
 * its own direct address (`maps.<name>.levels[k].url`, `docs/FORMAT.md` "Impostor atlases"); the
 * card feeds those addresses through the engine's ONE level reader and holds the decoded levels in
 * that reader's own store, within its budget (`texture/levelReader.ts`, `texture/levelStore.ts`).
 * There is no second loader and no second budget.
 */
import {
  PREVIEW_LOSSLESS_FORMAT,
  type ImpostorMap,
  type ImpostorMaps,
} from '../../../sdk-core/src/index.ts';
import type {
  TextureLevel,
  TextureLevelReader,
  TextureLevelRequest,
} from '../texture/levelReader.ts';

/** Id one atlas level is held under in the level store: content-addressed, like the file it read. */
export const impostorLevelId = (sha256: string) => sha256;

/** The reader request of every level of one atlas map, level 0 first, each with its own url. */
export function impostorMapRequests(map: ImpostorMap): TextureLevelRequest[] {
  return map.levels.map((level, index) => ({
    sha256: level.sha256,
    atlas: 0,
    level: index,
    format: PREVIEW_LOSSLESS_FORMAT,
    url: level.url,
  }));
}

/**
 * Reads one atlas map through `reader` and holds each level in the reader's own store under the cook
 * it was made for. A reader without a store (a test, a node host) still reads; the caller then owns
 * the levels.
 */
export async function loadImpostorMap(
  map: ImpostorMap,
  reader: TextureLevelReader,
): Promise<TextureLevel[]> {
  const levels: TextureLevel[] = [];
  for (const request of impostorMapRequests(map)) {
    const level = await reader(request);
    reader.store?.take(impostorLevelId(request.sha256), level, reader.key);
    levels.push(level);
  }
  return levels;
}

/** The three maps of one card, level 0 first, through the same reader and the same store. */
export async function loadImpostorAtlas(maps: ImpostorMaps, reader: TextureLevelReader) {
  return {
    colourCoverage: await loadImpostorMap(maps.colourCoverage, reader),
    normalDepth: await loadImpostorMap(maps.normalDepth, reader),
    orm: await loadImpostorMap(maps.orm, reader),
  };
}
