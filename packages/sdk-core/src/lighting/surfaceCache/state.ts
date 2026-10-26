import { createMarkedList } from '../../../../math/src/sequence/markedList.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { createCardSharing, type CardSharing } from './cardSharing.ts'
import type { Card, MeshCards, MeshCardsInstance } from './cardTypes.ts'
import { createKeyedHeap, type KeyedHeap } from './keyedHeap.ts'
import { createPageAllocator, type PageAllocator } from './pageAllocator.ts'
import { createSpanArray, type SpanArray } from './spanArray.ts'

/**
 * THE STATE OF THE SURFACE CACHE on the CPU: the cards of the scene, the page table that says where
 * in the atlas each card's pages are, who holds each physical page, and the lists the passes of an
 * image keep (`update.ts`).
 *
 * The page table is an array of PAGES, each a virtual page of one mip of one card. A page is MAPPED
 * when it holds a physical page — or a part of one — of the atlas. A page that is not mapped
 * reads the page of the next coarser mip of its card that holds what it should show (`samplePage`),
 * so that a read of a finer level never finds nothing as long as the coarsest level is in the atlas.
 */

/** One virtual page of a card's mip. */
export interface Page {
  /** The card it belongs to, and its level. */
  card: number
  resLevel: number
  /** The physical page, -1 while it holds none, and the rectangle of the atlas it holds, in texels. */
  physX: number
  physY: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Whether it is mapped for a capture that was not made yet: the texels it holds are another page's
   *  until the image that draws them is shaded (`confirmPages`). A read finds none there, and goes on
   *  to the next coarser page; a page captured again is not pending, it keeps its own. */
  pending: boolean
  /** The page a read of this one reads: itself while it is mapped and captured, else the next coarser
   *  one that is — with the position of its rectangle in the atlas in units of the least resolution
   *  and the level of each of its axes. None (zeros) while no page of its card reads. */
  samplePage: number
  sampleBiasX: number
  sampleBiasY: number
  sampleResLevelX: number
  sampleResLevelY: number
  /** The part of the card it covers, in the card's UV: `x0, y0, x1, y1`, widened by half a texel on
   *  each side it shares with a neighbour. */
  uvX0: number
  uvY0: number
  uvX1: number
  uvY1: number
  /** The size of the part of a physical page it takes, -1 if it takes a whole one. */
  subWidth: number
  subHeight: number
}

/** A page of the page table, not mapped. */
export const newPage = (): Page => ({
  card: -1,
  resLevel: 0,
  physX: -1,
  physY: -1,
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  pending: false,
  samplePage: 0,
  sampleBiasX: 0,
  sampleBiasY: 0,
  sampleResLevelX: 0,
  sampleResLevelY: 0,
  uvX0: 0,
  uvY0: 0,
  uvX1: 0,
  uvY1: 0,
  subWidth: -1,
  subHeight: -1,
})

/** Whether the page holds a physical page, or a part of one. */
export const isMapped = (page: Page) => page.physX >= 0 && page.physY >= 0

/** Whether the page takes a part of a physical page. */
export const isSubAllocation = (page: Page) => page.subWidth >= 0 || page.subHeight >= 0

/** A request for a card's pages: the whole of its coarsest mip, kept locked, or one page of a finer
 *  mip. */
export interface SurfaceRequest {
  readonly card: number
  /** The level asked for. */
  readonly resLevel: number
  /** The page of that mip asked for; `LOCKED_MIP` for the whole mip. */
  readonly localPage: number
  /** The bin of its distance from the eye (`distanceBin`): the nearer ones are served first. */
  readonly bin: number
}

/** The `localPage` of a request for the whole coarsest mip. */
export const LOCKED_MIP = 0xffff

/** Whether `request` asks for the whole coarsest mip of its card. */
export const isLockedMip = (request: SurfaceRequest) => request.localPage === LOCKED_MIP

/** A placement of a mesh that has cards: what the scene knows of it. */
export interface Placement {
  readonly id: number
  /** Its matrix, metres, by column. */
  readonly world: Float64Array
  readonly mesh: MeshCards
  /** The same for placements whose cards may copy one another, -1 for none. */
  readonly shareId: number
  readonly emissive: boolean
  /** Whether its material is opaque or masked: a translucent one has no cards unless the scene asks
   *  for them. */
  readonly opaqueOrMasked: boolean
  /** Its box in the world, centimetres: `minX, minY, minZ, maxX, maxY, maxZ`, and its greater half
   *  side. */
  readonly bounds: Float64Array
  extentMax: number
  /** Whether its mesh cards are in the scene. */
  visible: boolean
  /** Whether it can have mesh cards: false once its mesh cards were refused. */
  validMeshCards: boolean
  /** The index of its mesh cards, -1 while it has none. */
  meshCards: number
}

/** What the passes of an image counted. */
interface SurfaceCacheStats {
  /** The placements that wanted mesh cards, the cards that wanted a level, the finer pages
   *  requested. */
  meshCardsToAdd: number
  lockedCardsToUpdate: number
  hiResPagesToAdd: number
  /** The texels the cards the law keeps would take in the atlas at the levels it asks. */
  desiredTexels: number
}

/** Indices each listed once, in the order they came. */
export type IndexList = ReturnType<typeof createMarkedList>

/** The indices the GPU's tables have not heard of since the last upload, each once. */
interface SurfaceCacheChanges {
  readonly cards: IndexList
  readonly meshCards: IndexList
  readonly pages: IndexList
  /** The placements whose mesh cards came or went: the table that takes a placement to its mesh
   *  cards (a placement is named by a small whole number, the rank that indexes that table). */
  readonly placements: IndexList
}

/** The surface cache of a scene. */
export interface SurfaceCache {
  /** The settings of the last image. */
  settings: SurfaceCacheSettings
  /** The pages along a side of the atlas, 0 before the first image. */
  atlasPages: number
  /** Whether the atlas keeps its albedo, normal and emission in blocks (`surfaceCacheCompress`): the
   *  atlas is made again, and emptied, when that changes. */
  compressed: boolean
  /** Who holds the physical pages. */
  allocator: PageAllocator
  readonly cards: SpanArray<Card>
  readonly meshCards: SpanArray<MeshCardsInstance>
  readonly pages: SpanArray<Page>
  readonly placements: Map<number, Placement>
  /** The mapped pages that are not locked, by the image they were last read at: the pages that
   *  leave the atlas when it needs room. */
  readonly unlocked: KeyedHeap
  /** The mapped pages by the update frame they were last captured at: the oldest are captured
   *  again. */
  readonly captured: KeyedHeap
  /** The pages asked to be captured again, by the frame of the request. */
  readonly recapture: KeyedHeap
  readonly sharing: CardSharing
  /** Whether cards copy one another, and whether a card that lowers its level takes it from its own
   *  finer one, as of the last image. */
  allowCardSharing: boolean
  allowDownsampleFromSelf: boolean
  /** The update frame (the clock of captures and of the light's updates) and the feedback frame
   *  (the clock of the pages' last reads). */
  frame: number
  feedbackFrame: number
  readonly changes: SurfaceCacheChanges
  readonly stats: SurfaceCacheStats
}

/** A surface cache with nothing in it: its atlas is made at the first image. */
export function createSurfaceCache(settings: SurfaceCacheSettings): SurfaceCache {
  return {
    settings,
    atlasPages: 0,
    compressed: false,
    allocator: createPageAllocator(0, 0),
    cards: createSpanArray<Card>(),
    meshCards: createSpanArray<MeshCardsInstance>(),
    pages: createSpanArray<Page>(),
    placements: new Map(),
    unlocked: createKeyedHeap(),
    captured: createKeyedHeap(),
    recapture: createKeyedHeap(),
    sharing: createCardSharing(),
    allowCardSharing: false,
    allowDownsampleFromSelf: false,
    frame: 1,
    feedbackFrame: 0,
    changes: {
      cards: createMarkedList(),
      meshCards: createMarkedList(),
      pages: createMarkedList(),
      placements: createMarkedList(),
    },
    stats: { meshCardsToAdd: 0, lockedCardsToUpdate: 0, hiResPagesToAdd: 0, desiredTexels: 0 },
  }
}
