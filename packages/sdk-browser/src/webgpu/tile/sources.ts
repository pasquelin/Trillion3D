import type { TilePlace } from '../../texture/tiles.ts'
import type { TextureLevelReader } from '../../texture/levelReader.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { heldLevelsOf, type HeldLevels, type LevelFailed } from '../../texture/heldLevels.ts'
import type { TileScratch } from './scratch.ts'
import { buildHostScratch, createScratchBuilds, type Build } from './scratchBuilds.ts'
import { copyLiveTexture, liveScratches, pictureFits } from './live.ts'
import type { TileKey } from './pageTable.ts'
import type { TileCounters } from './counters.ts'
import { serveBaked, serveHost, type Served, type TileAsk } from './serveTile.ts'
import { copyTailFromTexture } from './write.ts'

type SourcesOptions = {
  device: GPUDevice
  readLevel?: TextureLevelReader
  /** Which level file each lane samples: a family's blocks, or the lossless one. */
  encoding: PoolEncoding
  counters: TileCounters
  onFailure: (phase: string, error: unknown) => void
}

/** The pass's encoder, opened at the first copy that needs it. */
type OpenEncoder = () => GPUCommandEncoder

/** What the sources hold: the held levels and who hears a read of theirs fail, the live working
 *  textures, those built off the frame. */
type Sources = {
  device: GPUDevice
  encoding: PoolEncoding
  levels: HeldLevels | undefined
  failed: LevelFailed
  build: Build
  live: ReturnType<typeof liveScratches>
  builds: ReturnType<typeof createScratchBuilds>
}

/** A working texture's key: its slot and atlas as one number, nothing built per copy. */
const scratchId = (atlas: WebgpuTileAtlas, slot: number) =>
  slot * 2 + (atlas.kind === 'color' ? 0 : 1)

/** The working texture held for `id`: live, or built off the frame. */
const heldScratch = ({ live, builds }: Sources, id: number) => live.get(id) ?? builds.get(id)

/** `use` on the working texture held, or on one built for it and freed after: never inside a
 *  pass — the textures built off the frame wait for the next pass. */
function withScratch(
  sources: Sources,
  atlas: WebgpuTileAtlas,
  slot: number,
  use: (s: TileScratch) => void,
) {
  const kept = heldScratch(sources, scratchId(atlas, slot)),
    scratch = kept ?? sources.build(atlas, slot)
  try {
    use(scratch)
  } finally {
    if (!kept) scratch.destroy()
  }
}

/** Serves a tile from its source (`Served`). */
function serveTile(sources: Sources, ask: TileAsk, encoder: OpenEncoder): Served {
  const { source } = ask.atlas.textures[ask.key.slot]
  if (source.kind === 'baked') return serveBaked(sources, source, ask)
  if (source.kind !== 'host') throw new Error('TEXTURE_TILE_WITHOUT_SOURCE')
  const id = scratchId(ask.atlas, ask.key.slot)
  return serveHost(sources.builds, heldScratch(sources, id), id, ask, encoder)
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
  const { device, counters, encoding, readLevel, onFailure } = options
  // The session's one held-level read, the impostor atlases' too (`heldLevelsOf`).
  const levels = readLevel && heldLevelsOf(readLevel)
  const failed: LevelFailed = (address, error) =>
    onFailure(
      `texture-level-read-failed ${address.sha256}/${address.atlas}/${address.level}`,
      error,
    )
  const build: Build = (atlas, slot, encoder) =>
    buildHostScratch(device, counters, atlas, slot, encoder)
  const live = liveScratches(device, build),
    builds = createScratchBuilds(device, build, options.onFailure)
  const sources: Sources = { device, encoding, levels, failed, build, live, builds }
  return {
    release(atlas: WebgpuTileAtlas, slot: number) {
      const id = scratchId(atlas, slot)
      builds.release(id)
      live.release(id)
    },
    levels,
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
      live.refresh(atlas, slot, scratchId(atlas, slot))
      return true
    },
    reduce: (atlas: WebgpuTileAtlas, slot: number) => reduceHost(sources, atlas, slot),
    /** Bytes the live textures' working textures hold, mips included, beside the pool. */
    get liveBytes() {
      return live.bytes
    },
    /** End of pass: its copies submitted, its working textures freed — all but those built for
     *  tiles whose feedback, `frame`, has not come round since they were asked. */
    endPass(encoder?: GPUCommandEncoder, frame?: number) {
      if (encoder) device.queue.submit([encoder.finish()])
      builds.drop(frame)
    },
    get reading() {
      return (levels?.inFlight ?? 0) > 0 || builds.building !== undefined
    },
    settled: () => Promise.all([levels?.settled(), builds.building]).then(() => undefined),
    destroy() {
      builds.destroy()
      live.destroy()
    },
  }
}
