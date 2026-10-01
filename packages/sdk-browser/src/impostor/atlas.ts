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
  const requests = MAP_NAMES.map((name) => impostorMapRequests(maps[name]));
  // Content-addressed, like the file it read: the id is the level's fingerprint.
  const fresh = new Map<string, TextureLevel>();
  try {
    // The levels the store lacks, read together. A held level is taken from the store only once no
    // read is pending: the store may close it while another read lands; one it dropped meanwhile
    // is read again.
    for (;;) {
      const missing = new Map<string, TextureLevelRequest>();
      for (const request of requests.flat())
        if (!fresh.has(request.sha256) && !reader.store?.has(request.sha256))
          missing.set(request.sha256, request);
      if (!missing.size) break;
      const results = await Promise.allSettled([...missing.values()].map((r) => reader(r)));
      [...missing.keys()].forEach((id, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') fresh.set(id, result.value);
      });
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;
    }
    const levelOf = (request: TextureLevelRequest) =>
      fresh.get(request.sha256) ?? reader.store!.get(request.sha256)!;
    return use({
      colourCoverage: requests[0].map(levelOf),
      normalDepth: requests[1].map(levelOf),
      orm: requests[2].map(levelOf),
    });
  } finally {
    for (const [id, level] of fresh) {
      if (reader.store) reader.store.take(id, level, reader.key);
      else closeTextureLevel(level);
    }
  }
}
