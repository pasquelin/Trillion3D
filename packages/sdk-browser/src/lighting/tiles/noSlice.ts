// The light grid's word for a cell without a list, alone in its file: the core reads it without the
// lighting shaders.
/** A cell with no list of its own (`TILE_NO_SLICE`): no grid is built this image — it walks every
 *  light of the scene (`cellSlice`). A built grid never lacks a list: past its pool a column keeps the
 *  lights it got. */
export const TILE_NO_SLICE = 0xffffffff
