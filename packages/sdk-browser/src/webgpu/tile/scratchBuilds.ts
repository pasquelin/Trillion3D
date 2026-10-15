import type { WebgpuTileAtlas } from './atlasTypes.ts'
import { createTileScratch, type TileScratch } from './scratch.ts'
import { generateMaterialMips } from '../../texture/mipBatch.ts'
import type { TileCounters } from './counters.ts'
import { rgbaBytes } from '../../texture/imageExtent.ts'

/** The working texture of host texture `slot` of `atlas`, built now, its mips not yet; its picture
 *  in `encoder` when given (`TileScratch.settle` once submitted). */
export function buildHostScratch(
  device: GPUDevice,
  counters: TileCounters,
  atlas: WebgpuTileAtlas,
  slot: number,
  encoder?: GPUCommandEncoder,
) {
  const { layout, source } = atlas.textures[slot]
  if (source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST')
  const scratch = createTileScratch(
    device,
    {
      map: source.map,
      width: layout.width,
      height: layout.height,
      format: atlas.poolOf(slot).texture.format,
      errorCode:
        atlas.kind === 'color'
          ? 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE'
          : 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
      coverage: source.coverage,
    },
    encoder,
  )
  counters.scratches++
  counters.uploadedBytes += rgbaBytes(layout.width, layout.height)
  return scratch
}

/** Working textures built off the frame, held at most per pass — the whole source each; tiles of a
 *  third texture wait for a pass with room. They live until the pass is submitted: an encoded copy
 *  names its texture, which cannot be destroyed before. A live texture's is not counted. */
const MAX_SCRATCHES = 2

/** Builds host texture `slot`'s working texture, its picture in `encoder` when given. */
export type Build = (
  atlas: WebgpuTileAtlas,
  slot: number,
  encoder?: GPUCommandEncoder,
) => TileScratch
/** What the cache holds of an id, in one state: asked for the tiles of a feedback frame and not yet
 *  built; built off the frame, and whether a copy of this pass read it; or live (`refresh`). */
type Entry =
  | { state: 'asked'; atlas: WebgpuTileAtlas; slot: number; frame: number }
  | { state: 'built'; scratch: TileScratch; frame: number; read: boolean }
  | { state: 'live'; scratch: TileScratch }

/** Every entry asked, its picture and their mips in one encoder, one submit, each one built kept
 *  at its id with the frame it was asked at; an entry whose build fails is let go. */
function buildAsked(
  device: GPUDevice,
  entries: Map<number, Entry>,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D texture scratch' }),
    made: TileScratch[] = []
  let lost = 0
  for (const [id, entry] of entries) {
    if (entry.state !== 'asked') continue
    try {
      const scratch = build(entry.atlas, entry.slot, encoder)
      entries.set(id, { state: 'built', scratch, frame: entry.frame, read: false })
      made.push(scratch)
    } catch (error) {
      entries.delete(id)
      lost++
      onFailure('texture-tile-failed', error)
    }
  }
  if (made.length) {
    generateMaterialMips(
      device,
      made.map((scratch) => scratch.chain()),
      encoder,
    )
    device.queue.submit([encoder.finish()])
    for (const scratch of made) scratch.settle()
  }
  return lost
}

/**
 * THE WORKING TEXTURES OF THE HOST TEXTURES, one map under one key (`scratchId`, `sources.ts`), an
 * id in one state at a time (`Entry`): a texture whose picture moves turns LIVE (`refresh`, #362)
 * and keeps its working texture, refilled in place, from pass to pass; any other's is ASKED for the
 * tiles that need it, then BUILT off the frame — built inside the pass, the whole source uploaded
 * and reduced is a spike its budget never counted —, a task after the frame building what was
 * asked, their mips in one batch, and held until a pass copies from it, or until feedback newer than
 * its ask passes it over (`drop`): a pass run without that feedback would free it unread. At most
 * `MAX_SCRATCHES` entries not live, counted as they change state.
 */
export function createScratches(
  device: GPUDevice,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  const entries = new Map<number, Entry>()
  let building: Promise<void> | undefined,
    liveBytes = 0,
    // Entries asked or built: the ones a pass's room counts.
    passing = 0
  /** `id`'s entry let go, its texture freed. */
  const release = (id: number) => {
    const entry = entries.get(id)
    if (!entry) return
    if (entry.state === 'live') liveBytes -= entry.scratch.bytes
    else passing--
    if (entry.state !== 'asked') entry.scratch.destroy()
    entries.delete(id)
  }
  return {
    release,
    /** The working texture held for `id`, built or live, if one is. */
    get(id: number) {
      const entry = entries.get(id)
      return entry && entry.state !== 'asked' ? entry.scratch : undefined
    },
    /** A copy of this pass reads `id`'s working texture: one not live is freed at the pass's end. */
    read(id: number) {
      const entry = entries.get(id)
      if (entry?.state === 'built') entry.read = true
    },
    /** Asks `id`'s working texture for the tiles of feedback `frame`, if a pass has room and the id
     *  holds nothing yet. */
    ask(id: number, frame: number, atlas: WebgpuTileAtlas, slot: number) {
      if (entries.has(id) || passing >= MAX_SCRATCHES) return
      entries.set(id, { state: 'asked', atlas, slot, frame })
      passing++
      building ??= new Promise<void>((done) =>
        setTimeout(() => {
          building = undefined
          try {
            passing -= buildAsked(device, entries, build, onFailure)
          } catch (error) {
            onFailure('texture-tile-failed', error)
          } finally {
            done()
          }
        }),
      )
    },
    /** A new picture of host texture `slot` of `atlas`, its working texture `id` refilled — or
     *  built, the texture turning live, whatever state it was in —, then `copy` encoded: its
     *  picture, its mips and its copies one submit. */
    refresh(
      atlas: WebgpuTileAtlas,
      slot: number,
      id: number,
      copy: (encoder: GPUCommandEncoder, texture: GPUTexture) => void,
    ) {
      const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' })
      const held = entries.get(id)
      let scratch: TileScratch
      if (held && held.state !== 'asked') {
        scratch = held.scratch
        scratch.fill(encoder)
      } else {
        scratch = build(atlas, slot, encoder)
        scratch.reduce(encoder)
      }
      if (held?.state !== 'live') {
        if (held) passing--
        liveBytes += scratch.bytes
        entries.set(id, { state: 'live', scratch })
      }
      copy(encoder, scratch.texture)
      device.queue.submit([encoder.finish()])
      scratch.rest()
    },
    /** Bytes the live textures' working textures hold, mips included. */
    get liveBytes() {
      return liveBytes
    },
    /** End of pass `frame`: frees the built working textures a copy read, or that feedback newer
     *  than their ask passed over; every built one without a frame. */
    drop(frame = Infinity) {
      for (const [id, entry] of entries)
        if (entry.state === 'built' && (entry.read || entry.frame < frame)) release(id)
    },
    get building() {
      return building
    },
    /** Every entry let go, the live ones too. */
    destroy() {
      for (const id of [...entries.keys()]) release(id)
    },
  }
}
