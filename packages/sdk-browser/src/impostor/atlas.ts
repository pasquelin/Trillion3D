/**
 * THE IMPOSTOR ATLAS, streamed like any texture (#1239, fact 3; #1335). Each level of an atlas map
 * carries its own direct address (`maps.<name>.levels[k].url`, `docs/FORMAT.md` "Impostor
 * atlases"); the card feeds those addresses through the engine's ONE level reader and holds the
 * decoded levels in that reader's own store, within its budget (`texture/levelReader.ts`,
 * `texture/levelStore.ts`). A level the store already holds is read from it, never fetched again.
 * There is no second loader and no second budget.
 */
import {
  PREVIEW_LOSSLESS_FORMAT,
  type ImpostorMap,
  type ImpostorMaps,
} from '../../../sdk-core/src/index.ts';
import {
  closeTextureLevel,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from '../texture/levelReader.ts';

/** The reader request of every level of one atlas map, level 0 first, each with its own url. */
function impostorMapRequests(map: ImpostorMap): TextureLevelRequest[] {
  return map.levels.map((level, index) => ({
    sha256: level.sha256,
    atlas: 0,
    level: index,
    format: PREVIEW_LOSSLESS_FORMAT,
    url: level.url,
  }));
}

/** The three maps of one card, each its levels, level 0 first. */
export type ImpostorAtlasLevels = Record<keyof ImpostorMaps, TextureLevel[]>;

/** One level read: from the store when it holds it (the store keeps it), else from the reader. */
type ReadLevel = { id: string; level: TextureLevel; fresh: boolean };
async function readLevel(request: TextureLevelRequest, reader: TextureLevelReader) {
  // Content-addressed, like the file it read: the id is the level's fingerprint.
  const id = request.sha256,
    held = reader.store?.get(id);
  if (held) return { id, level: held, fresh: false } satisfies ReadLevel;
  return { id, level: await reader(request), fresh: true } satisfies ReadLevel;
}

const MAP_NAMES = ['colourCoverage', 'normalDepth', 'orm'] as const;

/**
 * Reads the three maps of a card through `reader` and hands their levels to `use` (the GPU feed
 * copies them, `webgpu/impostor/feed.ts`). Then each level read here goes to the reader's store
 * under the cook it was made for, which holds it within its budget or closes it; a reader without a
 * store (a node host) closes it at once. A level the store already held stays its own.
 */
export async function loadImpostorAtlas<T>(
  maps: ImpostorMaps,
  reader: TextureLevelReader,
  use: (atlas: ImpostorAtlasLevels) => T,
): Promise<T> {
  // The levels are independent: read them together, in order, instead of one after the other.
  const read = await Promise.all(
    MAP_NAMES.map((name) =>
      Promise.all(impostorMapRequests(maps[name]).map((request) => readLevel(request, reader))),
    ),
  );
  try {
    return use({
      colourCoverage: read[0].map((entry) => entry.level),
      normalDepth: read[1].map((entry) => entry.level),
      orm: read[2].map((entry) => entry.level),
    });
  } finally {
    for (const entry of read.flat())
      if (!entry.fresh) continue;
      else if (reader.store) reader.store.take(entry.id, entry.level, reader.key);
      else closeTextureLevel(entry.level);
  }
}
