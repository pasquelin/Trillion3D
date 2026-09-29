import type { ShadowViewpoint } from '../light/contracts.ts';
import { frustumExcludesBox } from '../../math/frustum/box.ts';
import { SHADOW_PAGE } from './virtual.ts';

/** Floats of a receiver: its world box, least corner then most. */
export const RECEIVER_FLOATS = 6;

/** The surfaces a frame's shading lights, as the host hands them before its shadow raster. */
export interface ShadowReceivers {
  /** World boxes, `RECEIVER_FLOATS` each: every lit surface of the frame lies in one. */
  boxes: ArrayLike<number>;
  count: number;
  /** The camera's six frustum planes (`frustumPlanesFromMatrix`): what lies outside is not lit. */
  planes: Float64Array;
  /** World size of a pixel of the drawn target at the near plane, where a lit point's footprint
   *  starts: the view's own `pixelNear` is the display's. */
  pixelNear: number;
  /** An orthographic camera: every pixel's footprint is `pixelNear`. */
  orthographic: boolean;
}

/** Least view depth over the box at `o`: its nearest corner along the view's axis. */
export function boxDepth(box: ArrayLike<number>, o: number, view: ShadowViewpoint) {
  const f = view.forward,
    e = view.position;
  let depth = 0;
  for (let k = 0; k < 3; k++) depth += f[k] * ((f[k] > 0 ? box[o + k] : box[o + 3 + k]) - e[k]);
  return depth;
}

/**
 * RECEIVERS GATHERED BY CELL, before any light reads them: a frame draws tens of thousands of
 * clusters, and the pages a light reads over one are those of its neighbours. Each box the
 * frustum keeps joins the cell of its centre on a grid whose step is the power of two at most half
 * the least page its pixels can read — a level's texel is at most the pixel's footprint and more
 * than half of it, so a page of `SHADOW_PAGE` texels spans at least `SHADOW_PAGE / 2` footprints
 * —: a cell is the union of its boxes, and it holds every surface they hold. What it adds is the
 * pages around its empty corners, at most a page's width. Allocates only to grow.
 */
export function createReceiverCells() {
  let boxes = new Float64Array(0),
    keys = new Int32Array(0),
    slots = new Int32Array(0),
    mask = 0;
  const cells = { boxes, count: 0 };
  const grow = (count: number) => {
    boxes = cells.boxes = new Float64Array(count * RECEIVER_FLOATS);
    keys = new Int32Array(count * 4);
    const size = 2 ** Math.ceil(Math.log2(count * 2 + 1));
    slots = new Int32Array(size);
    mask = size - 1;
  };
  /** The cell `(level, x, y, z)`: found, or opened as `box`. */
  const join = (
    level: number,
    x: number,
    y: number,
    z: number,
    box: ArrayLike<number>,
    o: number,
  ) => {
    let at =
      (Math.imul(level, 73856093) ^
        Math.imul(x, 19349663) ^
        Math.imul(y, 83492791) ^
        Math.imul(z, 2654435761)) &
      mask;
    for (; slots[at]; at = (at + 1) & mask) {
      const c = slots[at] - 1,
        k = c * 4;
      if (keys[k] !== level || keys[k + 1] !== x || keys[k + 2] !== y || keys[k + 3] !== z)
        continue;
      for (let a = 0; a < 3; a++) {
        boxes[c * RECEIVER_FLOATS + a] = Math.min(boxes[c * RECEIVER_FLOATS + a], box[o + a]);
        boxes[c * RECEIVER_FLOATS + 3 + a] = Math.max(
          boxes[c * RECEIVER_FLOATS + 3 + a],
          box[o + 3 + a],
        );
      }
      return;
    }
    const c = cells.count++;
    slots[at] = c + 1;
    keys[c * 4] = level;
    keys[c * 4 + 1] = x;
    keys[c * 4 + 2] = y;
    keys[c * 4 + 3] = z;
    for (let a = 0; a < RECEIVER_FLOATS; a++) boxes[c * RECEIVER_FLOATS + a] = box[o + a];
  };
  return {
    cells,
    /** Gathers `from`'s boxes the frustum keeps, seen from `view`; returns the cells. */
    gather(from: ShadowReceivers, view: ShadowViewpoint) {
      if (keys.length < from.count * 4) grow(from.count);
      slots.fill(0);
      cells.count = 0;
      const { boxes: b, planes } = from;
      for (let r = 0, o = 0; r < from.count; r++, o += RECEIVER_FLOATS) {
        if (frustumExcludesBox(planes, b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5]))
          continue;
        const depth = Math.max(boxDepth(b, o, view), view.near),
          least = from.orthographic ? from.pixelNear : (from.pixelNear * depth) / view.near,
          level = Math.floor(Math.log2((least * SHADOW_PAGE) / 4)),
          step = 2 ** -level;
        join(
          level,
          Math.floor(((b[o] + b[o + 3]) / 2) * step),
          Math.floor(((b[o + 1] + b[o + 4]) / 2) * step),
          Math.floor(((b[o + 2] + b[o + 5]) / 2) * step),
          b,
          o,
        );
      }
      return cells;
    },
  };
}
