import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import { createTileScratch, type TileScratch } from './scratch.ts'
import { generateMaterialMips } from '../texture/mipBatch.ts'
import type { TileCounters } from './counters.ts'
import { rgbaBytes } from '../texture/imageExtent.ts'

/** The working texture of host texture `slot` of `atlas`, built now — its picture up on the queue
 *  —, its mips and any turn of its raw texels with its first reduction (`TileScratch.settle` once
 *  submitted). */
export function buildHostScratch(
  device: GPUDevice,
  counters: TileCounters,
  atlas: WebgpuTileAtlas,
  slot: number,
) {
  const { layout, source } = atlas.textures[slot]
  if (source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST')
  const scratch = createTileScratch(device, {
    map: source.map,
    width: layout.width,
    height: layout.height,
    format: atlas.poolOf(slot).texture.format,
    errorCode:
      atlas.kind === 'color'
        ? 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE'
        : 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
  })
  counters.scratches++
  counters.uploadedBytes += rgbaBytes(layout.width, layout.height)
  return scratch
}

/** Working textures built off the frame, held at most per pass — the whole source each; tiles of a
 *  third texture wait for a pass with room. They live until the pass is submitted: an encoded copy
 *  names its texture, which cannot be destroyed before. A live texture's is not counted. */
const MAX_SCRATCHES = 2

/** Builds host texture `slot`'s working texture (`buildHostScratch`). */
export type Build = (atlas: WebgpuTileAtlas, slot: number) => TileScratch
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
      const scratch = build(entry.atlas, entry.slot)
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

/** What the cache holds: the entries by id, the build in flight, the bytes of the live working
 *  textures, and the entries asked or built — the ones a pass's room counts. */
type ScratchState = {
  entries: Map<number, Entry>
  building: Promise<void> | undefined
  liveBytes: number
  passing: number
}

/** `id`'s entry let go, its texture freed. */
function release(st: ScratchState, id: number) {
  const entry = st.entries.get(id)
  if (!entry) return
  if (entry.state === 'live') st.liveBytes -= entry.scratch.bytes
  else st.passing--
  if (entry.state !== 'asked') entry.scratch.destroy()
  st.entries.delete(id)
}

/** `refresh` of the cache: the working texture of `id` refilled or built, turned live, `copy` encoded. */
function refreshLive(
  st: ScratchState,
  device: GPUDevice,
  build: Build,
  atlas: WebgpuTileAtlas,
  slot: number,
  id: number,
  copy: (encoder: GPUCommandEncoder, texture: GPUTexture) => void,
) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' })
  const held = st.entries.get(id)
  let scratch: TileScratch
  if (held && held.state !== 'asked') {
    scratch = held.scratch
    scratch.fill(encoder)
  } else {
    scratch = build(atlas, slot)
    scratch.reduce(encoder)
  }
  if (held?.state !== 'live') {
    if (held) st.passing--
    st.liveBytes += scratch.bytes
    st.entries.set(id, { state: 'live', scratch })
  }
  copy(encoder, scratch.texture)
  device.queue.submit([encoder.finish()])
}

/** `ask` of the cache: `id`'s working texture asked for the tiles of feedback `frame`, built in a
 *  task after the frame. */
function askScratch(
  st: ScratchState,
  device: GPUDevice,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
  id: number,
  frame: number,
  atlas: WebgpuTileAtlas,
  slot: number,
) {
  const { entries } = st
  if (entries.has(id) || st.passing >= MAX_SCRATCHES) return
  entries.set(id, { state: 'asked', atlas, slot, frame })
  st.passing++
  st.building ??= new Promise<void>((done) =>
    setTimeout(() => {
      st.building = undefined
      try {
        st.passing -= buildAsked(device, entries, build, onFailure)
      } catch (error) {
        onFailure('texture-tile-failed', error)
      } finally {
        done()
      }
    }),
  )
}

/**
 * THE WORKING TEXTURES OF THE HOST TEXTURES, one map under one key (`scratchId`, `sources/sources.ts`), an
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
  const st: ScratchState = { entries: new Map(), building: undefined, liveBytes: 0, passing: 0 }
  const { entries } = st
  return {
    release: (id: number) => release(st, id),
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
      askScratch(st, device, build, onFailure, id, frame, atlas, slot)
    },
    /** A new picture of host texture `slot` of `atlas`, its working texture `id` refilled — or
     *  built, the texture turning live, whatever state it was in —, then `copy` encoded: its
     *  turn, its mips and its copies one submit; its raw texels kept for its next picture. */
    refresh(
      atlas: WebgpuTileAtlas,
      slot: number,
      id: number,
      copy: (encoder: GPUCommandEncoder, texture: GPUTexture) => void,
    ) {
      refreshLive(st, device, build, atlas, slot, id, copy)
    },
    /** Bytes the live textures' working textures hold, mips included. */
    get liveBytes() {
      return st.liveBytes
    },
    /** End of pass `frame`: frees the built working textures a copy read, or that feedback newer
     *  than their ask passed over; every built one without a frame. */
    drop(frame = Infinity) {
      for (const [id, entry] of entries)
        if (entry.state === 'built' && (entry.read || entry.frame < frame)) release(st, id)
    },
    get building() {
      return st.building
    },
    /** Every entry let go, the live ones too. */
    destroy() {
      for (const id of [...entries.keys()]) release(st, id)
    },
  }
}
