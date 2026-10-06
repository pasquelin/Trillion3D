import { core } from '../../impostor/borrowed.ts'
import { CARD_VIEW_FLOATS } from './cardWgsl.ts'
import { cardPipelines } from './pipelines.ts'
import { CARD_FLOATS } from '../../impostor/cards.ts'
import { createImpostorFeed } from './feed.ts'
import type { TextureLevelReader } from '../../texture/levelReader.ts'

/**
 * What the card pass holds beside its pipelines (`cardPipelines`, checked where the session
 * prepares): the image's group (view uniform, card records) and the atlas feed (`feed.ts`).
 */
export function createImpostorPass(
  device: GPUDevice,
  reader: TextureLevelReader,
  feedOptions: Parameters<typeof createImpostorFeed>[3],
) {
  const { imageLayout, atlasLayout, pipeline, visPipeline } = cardPipelines(device)
  const viewBuffer = device.createBuffer({
    label: 'Trillion3D impostor view',
    size: CARD_VIEW_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  let cardBuffer: GPUBuffer | undefined, imageGroup: GPUBindGroup | undefined
  return {
    pipeline,
    visPipeline,
    feed: createImpostorFeed(device, atlasLayout, reader, feedOptions),
    viewBuffer,
    /** The image's group over a card buffer of at least `cards` records (`grownCapacity`). */
    imageGroup(cards: number) {
      const bytes = Math.max(1, cards) * CARD_FLOATS * 4
      if (!cardBuffer || cardBuffer.size < bytes) {
        const size = core.grownCapacity(cardBuffer?.size ?? 0, bytes)
        cardBuffer?.destroy()
        cardBuffer = device.createBuffer({
          label: 'Trillion3D impostor cards',
          size,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
        imageGroup = device.createBindGroup({
          label: 'Trillion3D impostor image',
          layout: imageLayout,
          entries: [
            { binding: 0, resource: { buffer: viewBuffer } },
            { binding: 1, resource: { buffer: cardBuffer } },
          ],
        })
      }
      return { group: imageGroup!, buffer: cardBuffer }
    },
    dispose() {
      this.feed.dispose()
      viewBuffer.destroy()
      cardBuffer?.destroy()
    },
  }
}

export type ImpostorPass = ReturnType<typeof createImpostorPass>
