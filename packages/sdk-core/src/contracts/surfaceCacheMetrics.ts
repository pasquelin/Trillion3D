/**
 * What the surface cache did in the last image (`ShadowFrameMetrics.surfaceCache`): the cards its
 * atlas holds, how full the atlas is, what the image captured, and why the cache is off where it is.
 * `null` while the cache is not made: nothing asked it (a view that shows it, a ray that reads it),
 * or the scene's meshes keep no card.
 */
export interface SurfaceCacheFrameMetrics {
  /** The side, in texels, of the atlas and of the capture atlas where the image's pages are drawn. */
  atlasSide: number
  captureSide: number
  /** The GPU bytes the atlases, the tables and the capture's surfaces hold. */
  bytes: number
  /** The placements followed, and, of them, the mesh cards and the cards in the scene. */
  placements: number
  meshCards: number
  cards: number
  /** The physical pages of the atlas taken — whole or cut into parts — and all of them: the share is
   *  how full the atlas is. */
  pagesUsed: number
  pagesTotal: number
  /** The pages the image gave new texels because something asked for them — new to the atlas, or
   *  captured again after a change —, the pages it copied from another card's texels, the pages it
   *  captured again only to follow the materials (the periodic refresh, which keeps the light of the
   *  page), and those it asked for that no raster drew (they are asked again). */
  captured: number
  copied: number
  refreshed: number
  waiting: number
  /** The placements that wanted mesh cards and had none, the cards that wanted a level, the finer
   *  pages the feedback asked for, and the texels the cards the law keeps would take. */
  meshCardsToAdd: number
  lockedCardsToUpdate: number
  hiResPagesToAdd: number
  desiredTexels: number
  /** Whether a raster of the cards' views is plugged in: without one no page is captured. */
  raster: boolean
  /** Why the cache is off, none while it runs: the memory budget left no room for its atlases, a
   *  piece of the capture could not be made. */
  why: string | null
  /** Whether the atlas keeps its albedo, normal and emission in blocks (BC7, BC5, BC6H: a quarter of
   *  the bytes of the plain layers, `surfaceCacheCompress`), and, where it does not, why: the setting is
   *  0 or 1, or the device lacks the block formats. */
  compressed: boolean
  compressionWhy: string | null
}
