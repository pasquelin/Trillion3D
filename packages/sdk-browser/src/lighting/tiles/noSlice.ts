// The light grid's word for a cell without a list, alone in its file: the core reads it without the
// lighting shaders.
/** A cell with no list of its own (`TILE_NO_SLICE`): the pool had no room, the cell lies past the
 *  grid, or no grid is built — the cell walks every light of the scene (`cellSlice`). */
export const TILE_NO_SLICE = 0xffffffff
