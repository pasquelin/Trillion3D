import { INT_TEXELS, LIGHT_LIST_UNIT, WebglLightTexture } from './lightTexture.ts';
import { BOX_VALUES, boxPointDistance } from '../../../../sdk-core/src/math/primitives/box.ts';
import { grown } from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { invertMatrix4 } from '../../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';

/** Floats a light slot's reach takes: its world centre, then its range (0: every fragment). */
export const REACH_FLOATS = 4;
/** Cells a grid holds at most: past it the cells widen, so the starts stay within 256 rows. */
export const MOST_CELLS = 1 << 18;
/** A lamp's reach widened by this share of a cell: a fragment finds its cell in single
 *  precision, so a lamp that reaches it is never listed only in the cell next to it. */
export const CELL_MARGIN = 1 / 32;

/** How the program walks the lights that reach a fragment: the lights of every fragment
 *  (`lightGrid.x` of them, first in the lists) and those of the fragment's grid cell, both in slot
 *  order, merged, so the sum runs in slot order as with every light. */
export const LIGHT_GRID_GLSL = `uniform mat4 viewToGrid;uniform ivec3 gridCells;uniform ivec2 lightGrid;const int NO_LIGHT=1073741824;`;
export const LIGHT_LOOP_GLSL = `vec3 g=(viewToGrid*vec4(viewPosition,1.0)).xyz;ivec3 cell=ivec3(floor(g));int a=0,b=0,bEnd=0;
if(all(greaterThanEqual(cell,ivec3(0)))&&all(lessThan(cell,gridCells))){int k=lightGrid.y+(cell.z*gridCells.y+cell.y)*gridCells.x+cell.x;b=listEntry(k);bEnd=listEntry(k+1);}
while(a<lightGrid.x||b<bEnd){int ia=a<lightGrid.x?listEntry(a):NO_LIGHT,ib=b<bEnd?listEntry(b):NO_LIGHT,i;if(ia<ib){i=ia;a++;}else{i=ib;b++;}`;

/**
 * THE LIGHT GRID OF THE WEBGL2 PATH: a fragment evaluates the lights whose range reaches its cell
 * of a world grid laid over the lamps — a sun, an ambient or a lamp of no range reaches every
 * fragment —, so a scene of hundreds of lamps costs, per pixel, the lamps near that pixel, however
 * large its draws. A light left out adds nothing where it is left out: its range window is zero
 * past its range. The grid is the lamps' own: a cell is their median range, the grid their reach's
 * box. It is listed again only when a lamp's reach changes — a frame that moves the camera alone
 * sends only the view's matrix. One integer texture holds, end to end, the lights of every
 * fragment, each cell's first entry (one past the last cell, the end), then the cells' lists.
 */
export class WebglClusterLightLists {
  /** Each slot's reach, `REACH_FLOATS` a slot, written by the upload of the lights. */
  reach = new Float64Array(0);
  /** The reach the grid was listed from, and its slot count: `-1` before the first listing. */
  private listed = new Float64Array(0);
  private listedLights = -1;
  /** Lights of every fragment, the grid's cells on each axis, the texel of its first start. */
  private every = 0;
  private cells = [0, 0, 0];
  private base = 0;
  /** World to grid: cells of `side`, from `origin`. */
  private worldToGrid = new Float64Array(16);
  private inverse = new Float64Array(16);
  private viewToGrid = new Float32Array(16);
  /** The lamps' ranges, the (cell, slot) pairs of a listing, and each cell's count. */
  private ranges = new Float64Array(0);
  private pairs = new Int32Array(0);
  private counts = new Int32Array(0);
  private box = new Float64Array(BOX_VALUES);
  private texture: WebglLightTexture<Int32Array>;
  private at: Record<'viewToGrid' | 'gridCells' | 'lightGrid', WebGLUniformLocation | null>;
  private gl: WebGL2RenderingContext;
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.texture = new WebglLightTexture(gl, LIGHT_LIST_UNIT, INT_TEXELS, Int32Array);
    this.at = {
      viewToGrid: gl.getUniformLocation(program, 'viewToGrid'),
      gridCells: gl.getUniformLocation(program, 'gridCells'),
      lightGrid: gl.getUniformLocation(program, 'lightGrid'),
    };
  }
  /** Room for `count` slots' reach, before the lights write it. */
  reserve(count: number) {
    if (this.reach.length < count * REACH_FLOATS)
      this.reach = grown(this.reach, Float64Array, count * 2 * REACH_FLOATS);
  }
  /** Lists the `count` lights uploaded into the grid when their reach changed, and sends the
   *  lists then only; every frame, the program's walk of the grid from `view` (world to view). */
  build(count: number, view: ArrayLike<number>) {
    const size = count * REACH_FLOATS,
      reach = this.reach.subarray(0, size);
    if (count !== this.listedLights || !sameValues(reach, this.listed)) {
      if (this.listed.length < size) this.listed = new Float64Array(reach.length * 2);
      this.listed.set(reach);
      this.listedLights = count;
      this.texture.upload(this.list(count));
    } else this.texture.bind();
    const { gl, at, cells } = this;
    multiplyMatrix4Typed(this.viewToGrid, this.worldToGrid, invertMatrix4(this.inverse, view));
    gl.uniformMatrix4fv(at.viewToGrid, false, this.viewToGrid);
    gl.uniform3i(at.gridCells, cells[0], cells[1], cells[2]);
    gl.uniform2i(at.lightGrid, this.every, this.base);
  }
  /** Writes the lists; returns the texels they take. */
  private list(count: number) {
    const { reach, box } = this;
    let every = 0,
      ranged = 0;
    this.texture.reserve(count);
    if (this.ranges.length < count) this.ranges = new Float64Array(count * 2);
    box.fill(Infinity, 0, 3).fill(-Infinity, 3);
    for (let slot = 0, at = 0; slot < count; slot++, at += REACH_FLOATS) {
      const range = reach[at + 3];
      if (!inGrid(range)) {
        this.texture.data[every++] = slot;
        continue;
      }
      this.ranges[ranged++] = range;
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a], reach[at + a] - range);
        box[a + 3] = Math.max(box[a + 3], reach[at + a] + range);
      }
    }
    this.every = this.base = every;
    const cells = this.cells;
    if (!ranged) {
      cells.fill(0);
      return every;
    }
    // A cell as wide as the median lamp's range: a lamp touches a few cells, a cell a few lamps,
    // however far one lamp reaches.
    let side = this.ranges.subarray(0, ranged).sort()[ranged >> 1];
    let margin: number, total: number;
    for (; ; side *= 1.25) {
      margin = side * CELL_MARGIN;
      total = 1;
      for (let a = 0; a < 3; a++)
        total *= cells[a] = Math.max(1, Math.ceil((box[a + 3] - box[a] + 2 * margin) / side));
      if (total <= MOST_CELLS) break;
    }
    for (let a = 0; a < 3; a++) box[a] -= margin;
    const grid = this.worldToGrid.fill(0);
    grid[0] = grid[5] = grid[10] = 1 / side;
    grid[15] = 1;
    for (let a = 0; a < 3; a++) grid[12 + a] = -box[a] / side;
    const found = this.pair(count, side, margin);
    // A counting sort by cell, stable: each cell's lamps stay in slot order.
    if (this.counts.length < total + 1) this.counts = new Int32Array((total + 1) * 2);
    const counts = this.counts.fill(0, 0, total + 1),
      pairs = this.pairs;
    for (let p = 0; p < found; p++) counts[pairs[2 * p] + 1]++;
    const first = every + total + 1;
    this.texture.reserve(first + found);
    const data = this.texture.data;
    for (let c = 0, at = first; c <= total; c++) {
      at += counts[c];
      data[every + c] = counts[c] = at;
    }
    for (let p = 0; p < found; p++) data[counts[pairs[2 * p]]++] = pairs[2 * p + 1];
    return first + found;
  }
  /** Each (cell, slot) pair of a lamp whose reach, widened by `margin`, touches the cell. */
  private pair(count: number, side: number, margin: number) {
    const { reach, box, cells } = this,
      cell = new Float64Array(BOX_VALUES),
      lo = [0, 0, 0],
      hi = [0, 0, 0];
    let found = 0;
    for (let slot = 0, at = 0; slot < count; slot++, at += REACH_FLOATS) {
      const range = reach[at + 3],
        x = reach[at],
        y = reach[at + 1],
        z = reach[at + 2];
      if (!inGrid(range)) continue;
      for (let a = 0; a < 3; a++) {
        const from = reach[at + a] - box[a];
        lo[a] = Math.max(0, Math.floor((from - range - margin) / side));
        hi[a] = Math.min(cells[a] - 1, Math.floor((from + range + margin) / side));
      }
      for (let k = lo[2]; k <= hi[2]; k++)
        for (let j = lo[1]; j <= hi[1]; j++)
          for (let i = lo[0]; i <= hi[0]; i++) {
            cell[0] = box[0] + i * side;
            cell[1] = box[1] + j * side;
            cell[2] = box[2] + k * side;
            cell[3] = cell[0] + side;
            cell[4] = cell[1] + side;
            cell[5] = cell[2] + side;
            if (boxPointDistance(cell, 0, x, y, z) > range + margin) continue;
            if (this.pairs.length < 2 * found + 2)
              this.pairs = grown(this.pairs, Int32Array, Math.max(1024, 4 * found + 4));
            this.pairs[2 * found] = (k * cells[1] + j) * cells[0] + i;
            this.pairs[2 * found++ + 1] = slot;
          }
    }
    return found;
  }
  dispose() {
    this.texture.dispose();
  }
}

/** A lamp of a finite range sits in the grid; any other light reaches every fragment. */
const inGrid = (range: number) => range > 0 && range < Infinity;

function sameValues(a: Float64Array, b: Float64Array) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
