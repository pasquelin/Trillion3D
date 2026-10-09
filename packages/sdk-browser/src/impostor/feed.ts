/**
 * THE PER-MESH ATLAS FEED, one for both GPU paths: each baked mesh's three maps, read through the
 * session's one held-level read the tiles use (`atlas.ts`), handed once decoded to the path's
 * `make`, which copies them into its textures and binds them. Its bytes are texture memory held
 * within the one texture budget: `room` is what that budget leaves them. An atlas past the room is
 * not read; within it the atlases drawn least recently leave first, one the frame draws or one
 * being made never (`streaming/cacheEntries.ts`), keyed by mesh number: no string is built a
 * frame. Until its binding exists, `group` answers nothing and the root keeps its clusters — never
 * a hole. `landed` is told when a level lands, so a held image is drawn again.
 */
import type { ImpostorMaps } from '../../../sdk-core/src/index.ts'
import { loadImpostorAtlas, type ImpostorAtlasLevels } from './atlas.ts'
import type { TextureLevelReader } from '../texture/levelReader.ts'
import { core } from './borrowed.ts'

/** The three maps in binding order: colour and coverage, normal and depth, packed ORM. */
export const ATLAS_MAPS = ['colourCoverage', 'normalDepth', 'orm'] as const
/**
 * One mesh's atlas as the feed holds it from the moment its textures are asked of the device: its
 * GPU bytes; while its textures are made (`making`); its binding once made, the last frame that
 * drew it, and what frees its textures.
 */
export type FedAtlas<G> = {
  group?: G
  bytes: number
  drawn: number
  making: boolean
  release: () => void
}

/** What the feed knows of a mesh from its first ask, its atlas held or not: its GPU bytes, read
 *  once from its maps, and the feed's bytes when the device refused it — asked again only once the
 *  feed holds less —, `Infinity` otherwise. Kept beside the atlases, out of eviction's reach: a
 *  refusal outlives the atlas it refused. */
type KnownMesh = { bytes: number; refusedAt: number }

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
    /** Makes the textures of `entry` and hands them to `made` — at once or later —, or answers
     *  through `drop` or `refuse`. */
    make: (mesh: number, maps: ImpostorMaps, atlas: ImpostorAtlasLevels, entry: FedAtlas<G>) => void
  },
) {
  const { room, landed, onFailure, bytesOf, make } = options
  const levels = core.heldLevelsOf(reader)
  const failed = (address: { sha256: string }, error: unknown) =>
    onFailure(`impostor-level-read-failed ${address.sha256}`, error)
  /** The atlases by mesh number, drawn least recently first, past those being made: held until
   *  `made`. One that leaves frees its textures. */
  const atlases = core.createCacheEntries<FedAtlas<G>, number>((atlas) => atlas.release())
  /** Each mesh asked, by its number. */
  const known = new Map<number, KnownMesh>()
  /** What an atlas with no textures frees. */
  const release = () => undefined
  /** Frees the room `bytes` needs, the atlases drawn least recently first; false if it cannot.
   *  Those the frame draws were touched last: the first of them met ends the eviction. */
  const fits = (bytes: number, frame: number) => {
    atlases.evict((oldest) => oldest.drawn !== frame && atlases.bytes + bytes > room())
    return atlases.bytes + bytes <= room()
  }
  const feed = {
    /** GPU bytes of the atlases held, those being made included. */
    get bytes() {
      return atlases.bytes
    },
    closed: false,
    /** True while `entry` is still the feed's atlas of `mesh`: a make that lands late checks
     *  it. */
    holds: (mesh: number, entry: FedAtlas<G>) =>
      !feed.closed && atlases.entry(mesh)?.value === entry,
    /** Frees `mesh`'s atlas and its bytes. */
    drop: atlases.drop,
    /** `entry`, the atlas of `mesh`, is made: bound by `group`, its textures freed by `release`. */
    made(mesh: number, entry: FedAtlas<G>, group: G, release: () => void) {
      Object.assign(entry, { group, release, making: false })
      atlases.release(mesh)
    },
    /** `mesh`'s atlas the device refused: its bytes given back, asked again only once the feed
     *  holds less. */
    refuse(mesh: number) {
      if (!atlases.entry(mesh)?.value) return
      atlases.drop(mesh)
      known.get(mesh)!.refusedAt = atlases.bytes
    },
    /** The binding of `mesh`'s atlas, marked drawn at `frame`; absent until it is made, its levels
     *  read the first frames it is asked and fits. A refused or failed read leaves the mesh to its
     *  clusters, and is asked again; an atlas the device refused, once the feed holds less. */
    group(mesh: number, maps: ImpostorMaps, frame: number) {
      if (feed.closed) return undefined
      const held = atlases.touch(mesh)
      if (held) {
        if (held.group) held.drawn = frame
        return held.group
      }
      let seen = known.get(mesh)
      if (!seen) known.set(mesh, (seen = { bytes: bytesOf(maps), refusedAt: Infinity }))
      const { bytes } = seen
      // An atlas past the whole room is never read: it would not fit even alone.
      if (bytes > room() || atlases.bytes >= seen.refusedAt) return undefined
      const atlas = loadImpostorAtlas(maps, levels, failed)
      if (typeof atlas === 'string' || !fits(bytes, frame)) return undefined
      seen.refusedAt = Infinity
      const entry: FedAtlas<G> = { bytes, drawn: -1, making: true, release }
      atlases.acquire(mesh)
      atlases.set(mesh, entry, bytes)
      make(mesh, maps, atlas, entry)
      // A path that makes it at once draws it this image.
      if (entry.group) entry.drawn = frame
      return entry.group
    },
    dispose() {
      feed.closed = true
      unwatch()
      atlases.clear()
      known.clear()
    },
  }
  const unwatch = levels.watch(() => feed.closed || landed())
  return feed
}
