import { core } from '../../impostor/borrowed.ts'
import { CARD_VIEW_FLOATS } from './cardWgsl.ts'
import { cardPipelines } from './pipelines.ts'
import { CARD_FLOATS } from '../../impostor/cardSlots.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import type { WebgpuTileAtlas } from '../tile/atlas.ts'

/** What the tile group is made over: the atlases' lane views and tables, and the maps' sampler. */
type TileSources = { color: WebgpuTileAtlas; data: WebgpuTileAtlas; sampler: GPUSampler }
/** What a tile group binds of its sources. */
type TileBound = {
  colorViews: readonly GPUTextureView[]
  dataViews: readonly GPUTextureView[]
  colorPages: GPUBuffer
  dataPages: GPUBuffer
  sampler: GPUSampler
}
const bindsAs = (held: TileBound, { color, data, sampler }: TileSources) =>
  held.colorViews === color.views &&
  held.dataViews === data.views &&
  held.colorPages === color.pages.buffer &&
  held.dataPages === data.pages.buffer &&
  held.sampler === sampler

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
  // The identifiers the visibility stage kept: a group for the view they are in, made again when it is.
  let idsOf: { view: GPUTextureView; group: GPUBindGroup } | undefined
  // The tile pool's group and what it was made over: made again when an atlas's views or table,
  // or the sampler, are — a pool replaced, a table regrown.
  let tilesOf: (TileBound & { group: GPUBindGroup }) | undefined
  return {
    surfacePipeline,
    visPipeline,
    viewBuffer,
    /** The image's group over a card buffer of at least `cards` records (`grownLength`). */
    imageGroup(cards: number) {
      const bytes = Math.max(1, cards) * CARD_FLOATS * 4
      if (!cardBuffer || cardBuffer.size < bytes) {
        const size = core.grownLength(cardBuffer?.size ?? 0, bytes)
        cardBuffer?.destroy()
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
    tilesGroup(tiles: TileSources) {
      if (tilesOf && bindsAs(tilesOf, tiles)) return tilesOf.group
      const { color, data, sampler } = tiles
      tilesOf = {
        ...{ colorViews: color.views, dataViews: data.views, sampler },
        ...{ colorPages: color.pages.buffer, dataPages: data.pages.buffer },
        group: device.createBindGroup({
          label: 'Trillion3D impostor tiles',
          layout: tilesLayout,
          entries: core.cardTileEntries(tiles, sampler),
        }),
      }
      return tilesOf.group
    },
    /** The group over the identifiers texture `view`, group 2 of the surface stage. */
    idsGroup(view: GPUTextureView) {
      if (idsOf?.view !== view)
        idsOf = {
          view,
          group: device.createBindGroup({
            label: 'Trillion3D impostor identifiers',
            layout: idsLayout,
            entries: sequentialEntries([view]),
          }),
        }
      return idsOf.group
    },
    dispose() {
      viewBuffer.destroy()
      cardBuffer?.destroy()
    },
  }
}

export type ImpostorPass = ReturnType<typeof createImpostorPass>
