// The limits of the WebGL2 light grid (`./lightLists.ts`), how it is written and how its program
// walks it.

/** Floats a light slot's reach takes: its world centre, then its range (0: every fragment). */
export const REACH_FLOATS = 4
/** Cells a grid holds at most: past it the cells widen, so the starts stay within 256 rows. */
export const MOST_CELLS = 1 << 18
/** Cells a grid holds at most per lamp it lists: the starts, their clearing and their upload
 *  scale with the lamps, never with the empty space between two far lamps. */
export const CELLS_PER_LAMP = 512
/** (cell, lamp) entries a grid lists at most: past it the cells widen, so a few far-reaching
 *  lamps among many small ones never list the whole grid each (1024 rows, beside the starts' 256,
 *  within the 2048 rows every WebGL2 device holds). */
export const MOST_ENTRIES = 1 << 20
/** Cells along one axis at most: a fragment's grid coordinate then stays below 2^12, where single
 *  precision errs by far less than `CELL_MARGIN`. */
export const MOST_CELLS_ON_AXIS = 1 << 12
/** A lamp's reach widened by this share of a cell: a fragment finds its cell in single
 *  precision, so a lamp that reaches it is never listed only in the cell next to it. */
export const CELL_MARGIN = 1 / 32

/** How the program walks the lights that reach a fragment: the lights of every fragment
 *  (`lightGrid` of them, first in the lists, then each cell's first entry) and those of the
 *  fragment's grid cell, both in slot order, merged, so the sum runs in slot order as with every
 *  light. The cell is tested in floats before it is made an integer: a point far off the grid
 *  never converts out of the integers' range. */
export const LIGHT_GRID_GLSL = `uniform mat4 viewToGrid;uniform ivec3 gridCells;uniform int lightGrid;const int NO_LIGHT=1073741824;`
export const LIGHT_LOOP_GLSL = `vec3 g=(viewToGrid*vec4(viewPosition,1.0)).xyz;int a=0,b=0,bEnd=0;
if(all(greaterThanEqual(g,vec3(0.0)))&&all(lessThan(g,vec3(gridCells)))){ivec3 cell=min(ivec3(g),gridCells-1);int k=lightGrid+(cell.z*gridCells.y+cell.y)*gridCells.x+cell.x;b=listEntry(k);bEnd=listEntry(k+1);}
int ia=a<lightGrid?listEntry(a):NO_LIGHT,ib=b<bEnd?listEntry(b):NO_LIGHT;
while(min(ia,ib)<NO_LIGHT){int i;if(ia<ib){i=ia;ia=++a<lightGrid?listEntry(a):NO_LIGHT;}else{i=ib;ib=++b<bEnd?listEntry(b):NO_LIGHT;}`

/**
 * Writes into `data`, from texel `every`, each of the `total` cells' first entry and one past the
 * last cell, then each cell's lamps: a counting sort of the `found` (cell, slot) `pairs` by cell,
 * stable, so each cell's lamps stay in slot order. `counts` holds `total + 1` integers at least.
 * Returns the texels the lists take.
 */
export function writeCells(
  data: Int32Array,
  every: number,
  total: number,
  counts: Int32Array,
  pairs: Int32Array,
  found: number,
) {
  counts.fill(0, 0, total + 1)
  for (let p = 0; p < found; p++) counts[pairs[2 * p] + 1]++
  const first = every + total + 1
  for (let c = 0, at = first; c <= total; c++) {
    at += counts[c]
    data[every + c] = counts[c] = at
  }
  for (let p = 0; p < found; p++) data[counts[pairs[2 * p]]++] = pairs[2 * p + 1]
  return first + found
}
