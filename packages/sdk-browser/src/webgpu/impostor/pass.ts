import { core } from '../../impostor/borrowed.ts'
import { CARD_VIEW_FLOATS } from './cardWgsl.ts'
import { cardPipelines } from './pipelines.ts'
import { CARD_FLOATS } from '../../impostor/cardSlots.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { CardAtlases } from '../tile/cardReads.ts'

/**
 * What the card pass holds beside its pipelines (`cardPipelines`, checked where the session
 * prepares): the image's group (view uniform, card records), the tile pool's group every card
 * reads its maps through, and the identifiers' group.
 */
export function createImpostorPass(device: GPUDevice) {
  const { imageLayout, tilesLayout, idsLayout, surfacePipeline, visPipeline } =
    cardPipelines(device)
  const viewBuffer = device.createBuffer({
    label: 'Trillion3D impostor view',
    size: CARD_VIEW_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // The image's group and the card buffer it binds, handed out as one object: none made an image.
  const image = {
    group: undefined as unknown as GPUBindGroup,
    buffer: undefined as unknown as GPUBuffer,
  }
  let cardBuffer: GPUBuffer | undefined
  // The identifiers the visibility stage kept: a group for the view they are in, made again when it
  // is. The tile pool's group: made again when an atlas's views or table, or the sampler, are — a
  // pool replaced, a table regrown.
  const ids = core.createWebgpuBindIdentity(),
    tiles = core.createWebgpuBindIdentity()
  let idsGroup: GPUBindGroup | undefined, tilesGroup: GPUBindGroup | undefined
  // What the tile group binds, set before its entries are read: they read it live.
  const bound = {
    atlases: undefined as unknown as CardAtlases,
    sampler: undefined as unknown as GPUSampler,
  }
  tiles.entries[0] = core.cardTileEntries(
    () => bound.atlases,
    () => bound.sampler,
  )
  return {
    surfacePipeline,
    visPipeline,
    viewBuffer,
    /** The image's group over a card buffer of at least `cards` records (`grownLength`). */
    imageGroup(cards: number) {
      const bytes = Math.max(1, cards) * CARD_FLOATS * 4
      if (!cardBuffer || cardBuffer.size < bytes) {
        const size = core.grownLength(cardBuffer?.size ?? 0, bytes)
        // Named by this image's commands not yet submitted: retired, never destroyed at once.
        if (cardBuffer) core.retire(device, cardBuffer)
        cardBuffer = device.createBuffer({
          label: 'Trillion3D impostor cards',
          size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
        image.buffer = cardBuffer
        image.group = device.createBindGroup({
          label: 'Trillion3D impostor image',
          layout: imageLayout,
          entries: sequentialEntries([{ buffer: viewBuffer }, { buffer: cardBuffer }]),
        })
      }
      return image
    },
    /** The tile pool's group, group 1 of every stage: the one binding of every card's maps. */
    tilesGroup(atlases: CardAtlases, sampler: GPUSampler) {
      bound.atlases = atlases
      bound.sampler = sampler
      if (tiles.entriesMoved(tilesLayout))
        tilesGroup = device.createBindGroup({
          label: 'Trillion3D impostor tiles',
          layout: tilesLayout,
          entries: tiles.entries[0],
        })
      return tilesGroup!
    },
    /** The group over the identifiers texture `view`, group 2 of the surface stage. */
    idsGroup(view: GPUTextureView) {
      ids.next[0] = view
      if (ids.moved())
        idsGroup = device.createBindGroup({
          label: 'Trillion3D impostor identifiers',
          layout: idsLayout,
          entries: sequentialEntries([view]),
        })
      return idsGroup!
    },
    dispose() {
      viewBuffer.destroy()
      cardBuffer?.destroy()
    },
  }
}

export type ImpostorPass = ReturnType<typeof createImpostorPass>
