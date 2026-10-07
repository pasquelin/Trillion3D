import type { WebgpuTileAtlas } from './atlas.ts'
import { createTileScratch, type TileScratch } from './scratch.ts'
import { generateMaterialMips } from '../../texture/mipBatch.ts'
import type { TileCounters } from './counters.ts'

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
  counters.uploadedBytes += layout.width * layout.height * 4
  return scratch
}

/** Working textures held at most per pass — the whole source each; tiles of a third texture wait
 *  for a pass with room. They live until the pass is submitted: an encoded copy names its
 *  texture, which cannot be destroyed before. */
const MAX_SCRATCHES = 2

/** A working texture asked, with the feedback frame it was asked at. */
type Asked = { atlas: WebgpuTileAtlas; slot: number; frame: number }
/** Builds host texture `slot`'s working texture, its picture in `encoder` when given. */
export type Build = (
  atlas: WebgpuTileAtlas,
  slot: number,
  encoder?: GPUCommandEncoder,
) => TileScratch

/** Every picture `asked` and their mips in one encoder, one submit, each one built kept in `built`
 *  with the frame it was asked at; `asked` emptied. */
function buildAsked(
  device: GPUDevice,
  asked: Map<number, Asked>,
  built: Map<number, { scratch: TileScratch; frame: number }>,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D texture scratch' }),
    made: TileScratch[] = []
  for (const [id, { atlas, slot, frame }] of asked)
    try {
      const scratch = build(atlas, slot, encoder)
      built.set(id, { scratch, frame })
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
 * The working textures tiles asked for, built off the frame: built inside the pass,
 * the whole source uploaded and reduced is a spike its budget never counted. A task after the frame
 * builds what was asked, their mips in one batch, and holds each until a pass copies from
 * it, or until feedback newer than its ask passes it over (`drop`): a pass run without that
 * feedback would free it unread.
 */
export function createScratchBuilds(
  device: GPUDevice,
  build: Build,
  onFailure: (phase: string, error: unknown) => void,
) {
  /** Working textures asked or built, each with the feedback frame it was asked at; and those a
   *  copy read this pass. */
  const asked = new Map<number, Asked>(),
    built = new Map<number, { scratch: TileScratch; frame: number }>(),
    copied = new Set<number>()
  let building: Promise<void> | undefined
  return {
    release(id: number) {
      asked.delete(id)
      built.get(id)?.scratch.destroy()
      built.delete(id)
      copied.delete(id)
    },
    /** The working texture built for `id`, if it is. */
    get: (id: number) => built.get(id)?.scratch,
    /** A copy of this pass reads `id`'s working texture: it is freed at the pass's end. */
    read: (id: number) => void copied.add(id),
    /** Asks `id`'s working texture for the tiles of feedback `frame`, if a pass has room. */
    ask(id: number, frame: number, atlas: WebgpuTileAtlas, slot: number) {
      if (built.size + asked.size >= MAX_SCRATCHES) return
      asked.set(id, { atlas, slot, frame })
      building ??= new Promise<void>((done) =>
        setTimeout(() => {
          building = undefined
          try {
            buildAsked(device, asked, built, build, onFailure)
          } catch (error) {
            onFailure('texture-tile-failed', error)
          } finally {
            done()
          }
        }),
      )
    },
    /** End of pass `frame`: frees the working textures a copy read, or that feedback newer than
     *  their ask passed over; every one without a frame. */
    drop(frame = Infinity) {
      for (const [id, { scratch, frame: askedAt }] of built)
        if (copied.has(id) || askedAt < frame) {
          scratch.destroy()
          built.delete(id)
        }
      copied.clear()
    },
    get building() {
      return building
    },
    /** Nothing asked is built, and what was built is freed. */
    destroy() {
      asked.clear()
      this.drop()
    },
  }
}
