/**
 * THE PER-MESH ATLAS FEED, one for both GPU paths (#1335, #1336): each baked mesh's three maps,
 * read through the one held-level read the tiles use (`atlas.ts`), handed once decoded to the
 * path's `make`, which copies them into its textures and binds them. Its bytes are texture memory
 * held within the one texture budget: `room` is what that budget leaves them. An atlas past the
 * room is not read; within it the atlases drawn least recently leave first, one the frame draws
 * never. Until its binding exists, `group` answers nothing and the root keeps its clusters — never
 * a hole. `landed` is told when levels land, so a held image is drawn again.
 */
import type { ImpostorMaps } from '../../../sdk-core/src/index.ts'
import { loadImpostorAtlas, type ImpostorAtlasLevels } from './atlas.ts'
import type { TextureLevelReader } from '../texture/levelReader.ts'
import { core } from './borrowed.ts'

/** The three maps in binding order: colour and coverage, normal and depth, packed ORM. */
export const ATLAS_MAPS = ['colourCoverage', 'normalDepth', 'orm'] as const
/** An atlas whose levels the browser decoded, as every lossless level is. */
export type DecodedAtlas = Record<keyof ImpostorAtlasLevels, ImageBitmap[]>
/** One mesh's atlas as the feed holds it: its binding once made, its bytes, the last frame that
 *  drew it, and what frees its textures. */
export type FedAtlas<G> = { group?: G; bytes: number; drawn: number; release: () => void }

export type AtlasFeedOptions = {
  room: () => number
  landed: () => void
  onFailure: (phase: string, error: unknown) => void
}

export function createAtlasFeed<G>(
  reader: TextureLevelReader,
  options: AtlasFeedOptions & {
    /** The GPU bytes of a mesh's atlas, read from its maps before any level is. */
    bytesOf: (maps: ImpostorMaps) => number
    /** Makes the textures of `entry`, sets its `group` and `release` once made — at once or later
     *  —, or answers through `drop` or `refuse`. */
    make: (key: string, maps: ImpostorMaps, atlas: DecodedAtlas, entry: FedAtlas<G>) => void
  },
) {
  const { room, landed, onFailure, bytesOf, make } = options
  const levels = core.createHeldLevels({
    read: reader,
    onFailure: (key, error) => onFailure(`impostor-level-read-failed ${key.sha256}`, error),
  })
  // Keyed by mesh number as text, in recency order: a group read re-inserts its mesh.
  const fed = new Map<string, FedAtlas<G>>()
  // Meshes whose atlas the device refused, each with the feed's bytes then: asked again only once
  // the feed holds less.
  const refused = new Map<string, number>()
  // Each mesh's atlas bytes, read once from its maps: a streaming mesh asks every image.
  const sizes = new Map<string, number>()
  let watching = false
  /** Frees the room `bytes` needs, the atlases drawn least recently first; false if it cannot. */
  const fits = (key: string, bytes: number, frame: number) => {
    core.evictOldest(
      fed.keys(),
      () => feed.bytes + bytes > room(),
      (other) => {
        const held = fed.get(other)!
        return other === key || !held.group || held.drawn === frame
      },
      feed.drop,
    )
    return feed.bytes + bytes <= room()
  }
  const feed = {
    /** GPU bytes of the atlases held, those being made included. */
    bytes: 0,
    closed: false,
    /** True while `entry` is still the feed's atlas of `key`: a make that lands late checks it. */
    holds: (key: string, entry: FedAtlas<G>) => !feed.closed && fed.get(key) === entry,
    /** Frees `key`'s atlas and its bytes. */
    drop(key: string) {
      const entry = fed.get(key)
      fed.delete(key)
      if (!entry) return
      feed.bytes -= entry.bytes
      entry.release()
    },
    /** Frees `key`'s atlas the device refused: asked again only once the feed holds less. */
    refuse(key: string) {
      feed.drop(key)
      refused.set(key, feed.bytes)
    },
    /** The binding of `mesh`'s atlas, marked drawn at `frame`; absent until it is made, its levels
     *  read the first frames it is asked and fits. A refused or failed read leaves the mesh to its
     *  clusters, and is asked again; an atlas the device refused, once the feed holds less. */
    group(mesh: number, maps: ImpostorMaps, frame: number) {
      const key = String(mesh)
      const entry = fed.get(key)
      if (entry) {
        fed.delete(key)
        fed.set(key, entry)
        if (entry.group) entry.drawn = frame
        return entry.group
      }
      // An atlas past the whole room is never read: it would not fit even alone.
      let bytes = sizes.get(key)
      if (bytes === undefined) sizes.set(key, (bytes = bytesOf(maps)))
      if (feed.closed || bytes > room() || feed.bytes >= (refused.get(key) ?? Infinity))
        return undefined
      refused.delete(key)
      const atlas = loadImpostorAtlas(maps, levels, frame)
      if (atlas === 'waiting' && !watching) {
        watching = true
        void levels.settled().then(() => {
          watching = false
          if (!feed.closed) landed()
        })
      }
      if (typeof atlas === 'string') return undefined
      if (ATLAS_MAPS.some((name) => atlas[name].some((level) => level instanceof Uint8Array)))
        return undefined
      if (!fits(key, bytes, frame)) return undefined
      const made: FedAtlas<G> = { bytes, drawn: -1, release: () => undefined }
      fed.set(key, made)
      feed.bytes += bytes
      make(key, maps, atlas as DecodedAtlas, made)
      // A path that makes it at once draws it this image.
      if (made.group) made.drawn = frame
      return made.group
    },
    dispose() {
      feed.closed = true
      for (const key of [...fed.keys()]) feed.drop(key)
      levels.destroy()
    },
  }
  return feed
}
