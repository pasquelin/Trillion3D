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

/** A working texture asked, with the feedback frame it was asked at. */
type Asked = { atlas: WebgpuTileAtlas; slot: number; frame: number }
/** Builds host texture `slot`'s working texture, its picture in `encoder` when given. */
export type Build = (
  atlas: WebgpuTileAtlas,
  slot: number,
  encoder?: GPUCommandEncoder,
) => TileScratch
/** A working texture held: the feedback frame it was asked at, and whether its texture is live
 *  (`refresh`), kept from pass to pass. */
type Held = { scratch: TileScratch; frame: number; live: boolean }

/** Every picture `asked` and their mips in one encoder, one submit, each one built kept in `held`
 *  with the frame it was asked at; `asked` emptied. */
function buildAsked(
  device: GPUDevice,
  asked: Map<number, Asked>,
  held: Map<number, Held>,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D texture scratch' }),
    made: TileScratch[] = []
  for (const [id, { atlas, slot, frame }] of asked)
    try {
      const scratch = build(atlas, slot, encoder)
      held.set(id, { scratch, frame, live: false })
      made.push(scratch)
    } catch (error) {
      onFailure('texture-tile-failed', error)
    }
  asked.clear()
  if (!made.length) return
  generateMaterialMips(
    device,
    made.map((scratch) => scratch.chain()),
    encoder,
  )
  device.queue.submit([encoder.finish()])
  for (const scratch of made) scratch.settle()
}

/**
 * THE WORKING TEXTURES OF THE HOST TEXTURES, one cache under one key (`scratchId`, `sources.ts`)
 * and one rule: a texture whose picture moves turns LIVE (`refresh`, #362) and keeps its working
 * texture, refilled in place, from pass to pass; any other's is built off the frame for the tiles
 * that ask it — built inside the pass, the whole source uploaded and reduced is a spike its budget
 * never counted —, a task after the frame building what was asked, their mips in one batch, and is
 * held until a pass copies from it, or until feedback newer than its ask passes it over (`drop`):
 * a pass run without that feedback would free it unread. An id held is never asked: `ask` is
 * called only for an id with nothing held, and `refresh` withdraws an ask its id made before.
 */
export function createScratches(
  device: GPUDevice,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  /** Working textures asked, and those held; those a copy read this pass; the live ones' bytes. */
  const asked = new Map<number, Asked>(),
    held = new Map<number, Held>(),
    copied = new Set<number>()
  let building: Promise<void> | undefined,
    liveBytes = 0
  return {
    release(id: number) {
      asked.delete(id)
      const entry = held.get(id)
      if (entry?.live) liveBytes -= entry.scratch.bytes
      entry?.scratch.destroy()
      held.delete(id)
      copied.delete(id)
    },
    /** The working texture held for `id`, if one is. */
    get: (id: number) => held.get(id)?.scratch,
    /** A copy of this pass reads `id`'s working texture: one not live is freed at the pass's end. */
    read: (id: number) => void copied.add(id),
    /** Asks `id`'s working texture for the tiles of feedback `frame`, if a pass has room. */
    ask(id: number, frame: number, atlas: WebgpuTileAtlas, slot: number) {
      let built = 0
      for (const entry of held.values()) if (!entry.live) built++
      if (built + asked.size >= MAX_SCRATCHES) return
      asked.set(id, { atlas, slot, frame })
      building ??= new Promise<void>((done) =>
        setTimeout(() => {
          building = undefined
          try {
            buildAsked(device, asked, held, build, onFailure)
          } catch (error) {
            onFailure('texture-tile-failed', error)
          } finally {
            done()
          }
        }),
      )
    },
    /** A new picture of host texture `slot` of `atlas`, its working texture `id` refilled — or
     *  built, the texture turning live —, then `copy` encoded: its turn, its mips and its copies
     *  one submit. Its turn keeps its ring and words for the next picture (`TileScratch.rest`). */
    refresh(
      atlas: WebgpuTileAtlas,
      slot: number,
      id: number,
      copy: (encoder: GPUCommandEncoder, texture: GPUTexture) => void,
    ) {
      // An id held is never asked: a build asked for it before it turned live is let go.
      asked.delete(id)
      const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' })
      let entry = held.get(id)
      if (entry) entry.scratch.fill(encoder)
      else {
        held.set(id, (entry = { scratch: build(atlas, slot, encoder), frame: 0, live: false }))
        entry.scratch.reduce(encoder)
      }
      if (!entry.live) liveBytes += entry.scratch.bytes
      entry.live = true
      copy(encoder, entry.scratch.texture)
      device.queue.submit([encoder.finish()])
      entry.scratch.rest()
    },
    /** Bytes the live textures' working textures hold, mips included. */
    get liveBytes() {
      return liveBytes
    },
    /** End of pass `frame`: frees the working textures not live that a copy read, or that feedback
     *  newer than their ask passed over; every one not live without a frame. */
    drop(frame = Infinity) {
      for (const [id, { scratch, frame: askedAt, live }] of held)
        if (!live && (copied.has(id) || askedAt < frame)) {
          scratch.destroy()
          held.delete(id)
        }
      copied.clear()
    },
    get building() {
      return building
    },
    /** Nothing asked is built, and every working texture is freed, the live ones too. */
    destroy() {
      asked.clear()
      for (const { scratch } of held.values()) scratch.destroy()
      held.clear()
      copied.clear()
      liveBytes = 0
    },
  }
}
