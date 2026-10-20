import type { TilePlace } from '../../texture/tiles.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import { heldLevelsOf, type HeldLevels, type LevelFailed } from '../../texture/heldLevels.ts'
import type { TileScratch } from './scratch.ts'
import { buildHostScratch, createScratches, type Build } from './scratchBuilds.ts'
import { copyLiveTexture, pictureFits } from './live.ts'
import type { TileKey } from './pageTable.ts'
import type { TileCounters } from './counters.ts'
import { serveBaked, serveHost, type Served, type TileAsk } from './serveTile.ts'
import { copyTailFromTexture } from './write.ts'
import type { TileTexture } from './tileTexture.ts'
import type { TextureLevelStore } from '../../texture/levelReader.ts'

type SourcesOptions = {
  device: GPUDevice
  /** Which level file each lane samples: a family's blocks, or the lossless one. */
  encoding: PoolEncoding
  counters: TileCounters
  onFailure: (phase: string, error: unknown) => void
}

/** The pass's encoder, opened at the first copy that needs it. */
type OpenEncoder = () => GPUCommandEncoder

/** What the sources hold: who hears a level read fail, and the working textures, live or built off
 *  the frame (`createScratches`). */
type Sources = {
  device: GPUDevice
  encoding: PoolEncoding
  failed: LevelFailed
  build: Build
  scratches: ReturnType<typeof createScratches>
}

/** A working texture's key: its slot and atlas as one number, nothing built per copy. */
const scratchId = (atlas: WebgpuTileAtlas, slot: number) =>
  slot * 2 + (atlas.kind === 'color' ? 0 : 1)

/** `use` on the working texture held, or on one built for it and freed after: never inside a
 *  pass — the textures built off the frame wait for the next pass. */
function withScratch(
  sources: Sources,
  atlas: WebgpuTileAtlas,
  slot: number,
  use: (s: TileScratch) => void,
) {
  const kept = sources.scratches.get(scratchId(atlas, slot)),
    scratch = kept ?? sources.build(atlas, slot)
  try {
    use(scratch)
  } finally {
    if (!kept) scratch.destroy()
  }
}

/** Serves a tile from its source (`Served`): a baked one through the held levels of its cache's
 *  reader, which it carries (`tileCatalogue`); a source of neither kind is refused by name. */
function serveTile(sources: Sources, ask: TileAsk, encoder: OpenEncoder): Served {
  const { source } = ask.atlas.textures[ask.key.slot]
  if (source.kind === 'baked') return serveBaked(sources, heldLevelsOf(source.read), source, ask)
  if (source.kind !== 'host') throw new Error('TEXTURE_TILE_WITHOUT_SOURCE')
  const id = scratchId(ask.atlas, ask.key.slot)
  return serveHost(sources.scratches, id, ask, encoder)
}

/** Queue of a host texture, copied from its working texture and submitted — at prepare, never
 *  inside a pass. */
function copyTail(sources: Sources, atlas: WebgpuTileAtlas, slot: number, place: TilePlace) {
  const { layout } = atlas.textures[slot]
  withScratch(sources, atlas, slot, (scratch) => {
    if (scratch.stale) scratch.reduce()
    const encoder = sources.device.createCommandEncoder({ label: 'Trillion3D texture tail' })
    copyTailFromTexture(
      encoder,
      atlas.poolOf(slot).texture,
      place,
      scratch.texture,
      [layout.width, layout.height],
      layout.tail,
      layout.last,
    )
    sources.device.queue.submit([encoder.finish()])
  })
}

/** A host texture whose readers' coverage rule moved (#42): its mips reduced again, copied, one
 *  submit; false when its picture's size moved. */
function reduceHost(sources: Sources, atlas: WebgpuTileAtlas, slot: number) {
  if (!pictureFits(atlas.textures[slot])) return false
  withScratch(sources, atlas, slot, (scratch) => {
    const encoder = sources.device.createCommandEncoder({ label: 'Trillion3D live texture' })
    scratch.reduce(encoder)
    copyLiveTexture(encoder, atlas, slot, scratch.texture)
    sources.device.queue.submit([encoder.finish()])
  })
  return true
}

/**
 * Where a tile's texels come from, and how they reach the pool of its lane: a cooked level decoded
 * by the browser, or a block tile's record as the file holds it, held in the page cache, or a
 * working texture built from the host image, which only the lossless lane receives. A tile whose
 * source is not yet in hand is not served; it will come back on the next feedback. A host texture's
 * tail takes the same path, one temporary working texture at a time.
 */
export function createTileSources(options: SourcesOptions) {
  const { device, counters, encoding, onFailure } = options
  // The held-level read of each cache the atlases catalogue (`hold`): the session's own, a joined
  // model's; and one of them per store, whose reads in flight and bytes are every cook's there.
  const levels = new Set<HeldLevels>()
  const stores = new Map<TextureLevelStore, HeldLevels>()
  const failed: LevelFailed = (address, error) =>
    onFailure(
      `texture-level-read-failed ${address.sha256}/${address.atlas}/${address.level}`,
      error,
    )
  const build: Build = (atlas, slot) => buildHostScratch(device, counters, atlas, slot)
  const scratches = createScratches(device, build, options.onFailure)
  const sources: Sources = { device, encoding, failed, build, scratches }
  /** Level reads, decoded levels and their bytes, every cache's; none before a cache is held. */
  const counts = {
    get inFlight() {
      let inFlight = 0
      for (const held of stores.values()) inFlight += held.inFlight
      return inFlight
    },
    get fetched() {
      let fetched = 0
      for (const held of levels) fetched += held.fetched
      return fetched
    },
    get bytes() {
      let bytes = 0
      for (const held of stores.values()) bytes += held.bytes
      return bytes
    },
  }
  return {
    release: (atlas: WebgpuTileAtlas, slot: number) => scratches.release(scratchId(atlas, slot)),
    /** The level reads of every cache held, counted together; none before one is. */
    get levels() {
      return levels.size ? counts : undefined
    },
    /** `texture`'s cache is read from: a chain baked past its tail, catalogued at open or appended. */
    hold(texture: TileTexture) {
      if (texture.source.kind !== 'baked') return
      const { read } = texture.source,
        held = heldLevelsOf(read)
      levels.add(held)
      if (!stores.has(read.store)) stores.set(read.store, held)
    },
    /** Who hears a level read of theirs fail. */
    failed,
    /** Serves a tile from its source (`Served`). */
    serve: (atlas: WebgpuTileAtlas, key: TileKey, frame: number, encoder: OpenEncoder) =>
      serveTile(sources, { atlas, key, frame }, encoder),
    /** Queue of a host texture, copied from its working texture and submitted. */
    tail: (atlas: WebgpuTileAtlas, slot: number, place: TilePlace) =>
      copyTail(sources, atlas, slot, place),
    /**
     * A host texture's new picture (#362): the texture turns live — it keeps one working texture
     * of its own size, refilled in place from now on —, and its tail and resident tiles are
     * copied again from it: the picture's turn, its mips and the copies one submit. A texture
     * whose picture never moves never gets here; one whose size moved is not copied — false —:
     * only a new session lays its tiles out again.
     */
    refresh(atlas: WebgpuTileAtlas, slot: number) {
      if (!pictureFits(atlas.textures[slot])) return false
      scratches.refresh(atlas, slot, scratchId(atlas, slot), (encoder, texture) =>
        copyLiveTexture(encoder, atlas, slot, texture),
      )
      return true
    },
    reduce: (atlas: WebgpuTileAtlas, slot: number) => reduceHost(sources, atlas, slot),
    /** Bytes the live textures' working textures hold, mips included, beside the pool. */
    get liveBytes() {
      return scratches.liveBytes
    },
    /** End of pass: its copies submitted, its working textures freed — all but those built for
     *  tiles whose feedback, `frame`, has not come round since they were asked. */
    endPass(encoder?: GPUCommandEncoder, frame?: number) {
      if (encoder) device.queue.submit([encoder.finish()])
      scratches.drop(frame)
    },
    get reading() {
      return counts.inFlight > 0 || scratches.building !== undefined
    },
    settled: () => {
      const waits: Promise<unknown>[] = [Promise.resolve(scratches.building)]
      for (const held of stores.values()) waits.push(held.settled())
      return Promise.all(waits).then(() => undefined)
    },
    destroy: () => scratches.destroy(),
  }
}
