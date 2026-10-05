// The cell arithmetic of the bounce occupancy map (`occupancy.ts`): marking a block, the 2×2×2
// reduction to the next level and the one-cell dilation, in place on flat maps, nothing allocated
// per cell.

/** Marks a block of cells, bounds included, staying within map; returns the cells newly marked. */
export function mark(map: Uint8Array, dims: number[], low: number[], high: number[]) {
  const x0 = Math.max(0, low[0]),
    y0 = Math.max(0, low[1]),
    z0 = Math.max(0, low[2]);
  const x1 = Math.min(dims[0] - 1, high[0]),
    y1 = Math.min(dims[1] - 1, high[1]),
    z1 = Math.min(dims[2] - 1, high[2]);
  let added = 0;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const row = dims[0] * (y + dims[1] * z);
      for (let x = x0; x <= x1; x++) {
        added += 1 - map[row + x];
        map[row + x] = 1;
      }
    }
  return added;
}

/** Map reduction: a cell in the next level is marked if any of the eight sub-cells are marked. */
export function reduce(map: Uint8Array, dims: number[]) {
  const next = dims.map((size) => Math.max(1, Math.ceil(size / 2)));
  const out = new Uint8Array(next[0] * next[1] * next[2]);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++) {
      const row = dims[0] * (y + dims[1] * z),
        half = next[0] * ((y >> 1) + next[1] * (z >> 1));
      for (let x = 0; x < dims[0]; x++) if (map[row + x]) out[half + (x >> 1)] = 1;
    }
  return { map: out, dims: next };
}

/** Dilates a map by one cell along three axes: required boundary for interpolation. */
export function dilate(map: Uint8Array, dims: number[]) {
  const out = new Uint8Array(map.length);
  const [width, height, depth] = dims;
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (!map[x + width * (y + height * z)]) continue;
        const x1 = Math.min(width - 1, x + 1),
          y1 = Math.min(height - 1, y + 1),
          z1 = Math.min(depth - 1, z + 1);
        for (let k = Math.max(0, z - 1); k <= z1; k++)
          for (let j = Math.max(0, y - 1); j <= y1; j++) {
            const row = width * (j + height * k);
            for (let i = Math.max(0, x - 1); i <= x1; i++) out[row + i] = 1;
          }
      }
  return out;
}

/** The cells, relative to `origin`, that box `at` of `boxes` (six bounds each) covers. */
export function cellsOf(
  boxes: ArrayLike<number>,
  at: number,
  spacing: number,
  origin: number[],
  low: number[],
  high: number[],
) {
  for (let axis = 0; axis < 3; axis++) {
    low[axis] = Math.floor(boxes[at + axis] / spacing) - origin[axis];
    high[axis] = Math.floor(boxes[at + 3 + axis] / spacing) - origin[axis];
  }
}

/** Whether `low`–`high` is the range `last` holds, which then takes it: a box whose cells equal
 *  the previous box's marks nothing new (marking is idempotent), so its caller skips it. */
export function repeats(low: number[], high: number[], last: number[]) {
  let same = true;
  for (let axis = 0; axis < 3; axis++) {
    same &&= low[axis] === last[axis] && high[axis] === last[axis + 3];
    last[axis] = low[axis];
    last[axis + 3] = high[axis];
  }
  return same;
}
