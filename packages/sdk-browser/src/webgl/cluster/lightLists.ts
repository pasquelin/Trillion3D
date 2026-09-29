import { INT_TEXELS, LIGHT_LIST_UNIT, WebglLightTexture } from './lightTexture.ts';
import {
  BOX_VALUES,
  boxEmpty,
  boxPointDistance,
  boxUnion,
} from '../../../../sdk-core/src/math/primitives/box.ts';
import { grown } from '../../../../sdk-core/src/math/transform-tree/transformTree.ts';
import { invertMatrix4 } from '../../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import { uniformScaleMatrix4 } from '../../../../sdk-core/src/math/matrix/matrix4Trs.ts';

/** Floats a light slot's reach takes: its world centre, then its range (0: every fragment). */
export const REACH_FLOATS = 4;
/** Cells a grid holds at most: past it the cells widen, so the starts stay within 256 rows. */
const MOST_CELLS = 1 << 18;
/** Cells a grid holds at most per lamp it lists: the starts, their clearing and their upload
 *  scale with the lamps, never with the empty space between two far lamps. */
const CELLS_PER_LAMP = 512;
/** (cell, lamp) entries a grid lists at most: past it the cells widen, so a few far-reaching
 *  lamps among many small ones never list the whole grid each (1024 rows, beside the starts' 256,
 *  within the 2048 rows every WebGL2 device holds). */
const MOST_ENTRIES = 1 << 20;
/** Cells along one axis at most: a fragment's grid coordinate then stays below 2^12, where single
 *  precision errs by far less than `CELL_MARGIN`. */
const MOST_CELLS_ON_AXIS = 1 << 12;
/** A lamp's reach widened by this share of a cell: a fragment finds its cell in single
 *  precision, so a lamp that reaches it is never listed only in the cell next to it. */
export const CELL_MARGIN = 1 / 32;

/** How the program walks the lights that reach a fragment: the lights of every fragment
 *  (`lightGrid` of them, first in the lists, then each cell's first entry) and those of the
 *  fragment's grid cell, both in slot order, merged, so the sum runs in slot order as with every
 *  light. The cell is tested in floats before it is made an integer: a point far off the grid
 *  never converts out of the integers' range. */
export const LIGHT_GRID_GLSL = `uniform mat4 viewToGrid;uniform ivec3 gridCells;uniform int lightGrid;const int NO_LIGHT=1073741824;`;
export const LIGHT_LOOP_GLSL = `vec3 g=(viewToGrid*vec4(viewPosition,1.0)).xyz;int a=0,b=0,bEnd=0;
if(all(greaterThanEqual(g,vec3(0.0)))&&all(lessThan(g,vec3(gridCells)))){ivec3 cell=min(ivec3(g),gridCells-1);int k=lightGrid+(cell.z*gridCells.y+cell.y)*gridCells.x+cell.x;b=listEntry(k);bEnd=listEntry(k+1);}
int ia=a<lightGrid?listEntry(a):NO_LIGHT,ib=b<bEnd?listEntry(b):NO_LIGHT;
while(min(ia,ib)<NO_LIGHT){int i;if(ia<ib){i=ia;ia=++a<lightGrid?listEntry(a):NO_LIGHT;}else{i=ib;ib=++b<bEnd?listEntry(b):NO_LIGHT;}`;

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
  /** The reach the grid was listed from: `undefined` before the first listing. */
  private listed?: Float64Array;
  /** Lights of every fragment, which is also the texel of the grid's first start. */
  private every = 0;
  private cells = [0, 0, 0];
  /** World to grid: cells of `side`, from the grid's low corner. */
  private worldToGrid = new Float64Array(16);
  private corner = [0, 0, 0];
  private inverse = new Float64Array(16);
  private viewToGrid = new Float32Array(16);
  /** The slots and ranges of the lamps in the grid, the (cell, slot) pairs of a listing, and
   *  each cell's count. */
  private ranged = new Int32Array(0);
  private ranges = new Float64Array(0);
  private pairs = new Int32Array(0);
  private counts = new Int32Array(0);
  private box = new Float64Array(BOX_VALUES);
  private cell = new Float64Array(BOX_VALUES);
  private lo = [0, 0, 0];
  private hi = [0, 0, 0];
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
    const reach = this.reach.subarray(0, count * REACH_FLOATS);
    if (!this.listed || !sameValues(reach, this.listed)) {
      this.listed = reach.slice();
      this.texture.upload(this.list(count));
    } else this.texture.bind();
    const { gl, at, cells } = this;
    multiplyMatrix4Typed(this.viewToGrid, this.worldToGrid, invertMatrix4(this.inverse, view));
    gl.uniformMatrix4fv(at.viewToGrid, false, this.viewToGrid);
    gl.uniform3i(at.gridCells, cells[0], cells[1], cells[2]);
    gl.uniform1i(at.lightGrid, this.every);
  }
  /** Writes the lists; returns the texels they take. */
  private list(count: number) {
    const { reach, box, cells } = this;
    let every = 0,
      ranged = 0;
    this.texture.reserve(count);
    if (this.ranged.length < count) {
      this.ranged = new Int32Array(count * 2);
      this.ranges = new Float64Array(count * 2);
    }
    boxEmpty(box, 0);
    for (let slot = 0, at = 0; slot < count; slot++, at += REACH_FLOATS) {
      const range = reach[at + 3],
        x = reach[at],
        y = reach[at + 1],
        z = reach[at + 2];
      if (!(range > 0 && range < Infinity)) this.texture.data[every++] = slot;
      // A lamp placed nowhere (a non-finite centre) reaches no point.
      else if (Number.isFinite(x + y + z)) {
        this.ranged[ranged] = slot;
        this.ranges[ranged++] = range;
        boxUnion(box, 0, x - range, y - range, z - range, x + range, y + range, z + range);
      }
    }
    this.every = every;
    if (!ranged) {
      cells.fill(0);
      return every;
    }
    // A cell as wide as the median lamp's range: a lamp touches a few cells, a cell a few lamps,
    // however far one lamp reaches.
    let side = this.ranges.subarray(0, ranged).sort()[ranged >> 1];
    const most = Math.min(MOST_CELLS, CELLS_PER_LAMP * ranged);
    let margin: number, total: number;
    for (; ; side *= 1.25) {
      margin = side * CELL_MARGIN;
      total = 1;
      let axis = 0;
      for (let a = 0; a < 3; a++) {
        cells[a] = Math.max(1, Math.ceil((box[a + 3] - box[a] + 2 * margin) / side));
        total *= cells[a];
        axis = Math.max(axis, cells[a]);
      }
      if (total <= most && axis <= MOST_CELLS_ON_AXIS && this.spanned(ranged, side, margin)) break;
    }
    const corner = this.corner;
    for (let a = 0; a < 3; a++) corner[a] = (margin - box[a]) / side;
    uniformScaleMatrix4(this.worldToGrid, 1 / side, corner);
    const found = this.pair(ranged, side, margin);
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
  /** The cells around the lamp at `at`, its reach widened by `margin`, into `lo` and `hi`; the
   *  grid's low corner is `margin` below the lamps' box. Returns how many they are. */
  private around(at: number, side: number, margin: number) {
    const { reach, box, cells, lo, hi } = this;
    const range = reach[at + 3] + margin;
    let span = 1;
    for (let a = 0; a < 3; a++) {
      const from = reach[at + a] - box[a] + margin;
      lo[a] = Math.max(0, Math.floor((from - range) / side));
      hi[a] = Math.min(cells[a] - 1, Math.floor((from + range) / side));
      span *= hi[a] - lo[a] + 1;
    }
    return span;
  }
  /** Whether the cells around every lamp stay within `MOST_ENTRIES`, or one cell a lamp. */
  private spanned(ranged: number, side: number, margin: number) {
    const most = Math.max(MOST_ENTRIES, ranged);
    let spans = 0;
    for (let n = 0; n < ranged; n++)
      if ((spans += this.around(this.ranged[n] * REACH_FLOATS, side, margin)) > most) return false;
    return true;
  }
  /** Each (cell, slot) pair of a ranged lamp whose reach, widened by `margin`, touches the cell. */
  private pair(ranged: number, side: number, margin: number) {
    const { reach, box, cells, cell, lo, hi } = this;
    let found = 0;
    for (let n = 0; n < ranged; n++) {
      const slot = this.ranged[n],
        at = slot * REACH_FLOATS,
        range = reach[at + 3] + margin,
        x = reach[at],
        y = reach[at + 1],
        z = reach[at + 2];
      this.around(at, side, margin);
      for (let k = lo[2]; k <= hi[2]; k++)
        for (let j = lo[1]; j <= hi[1]; j++)
          for (let i = lo[0]; i <= hi[0]; i++) {
            cell[0] = box[0] - margin + i * side;
            cell[1] = box[1] - margin + j * side;
            cell[2] = box[2] - margin + k * side;
            cell[3] = cell[0] + side;
            cell[4] = cell[1] + side;
            cell[5] = cell[2] + side;
            if (boxPointDistance(cell, 0, x, y, z) > range) continue;
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

function sameValues(a: Float64Array, b: Float64Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
