import { growBox, type DemandLight } from './demandLamp.ts';
import type { SunLevels } from './sunLevels.ts';
import { SUN_LEVELS, SUN_WINDOW, sunEntry, sunPageMetres } from './virtual.ts';

/**
 * A sun as its shading reads it (`sunShadowFactor`): the clipmap level whose texel, `2^L` metres,
 * is at most the pixel's footprint, from the finest on, and at that level the page under the point
 * along the light plane — `right` across, `up` down. Over a box: the levels between its least and
 * its most footprint, within the clipmap, and at each the pages of this frame's extent the box's
 * projection covers. One reader, aimed at each sun in turn: a frame allocates nothing.
 */
export function createSunDemand(levels: SunLevels) {
  const grown = new Float64Array(6),
    span = new Float64Array(4);
  let slice = 0,
    base = 0,
    marked: (entry: number) => void = () => {};
  /** Least and most of `sign · axis · p` over the grown box, `axis` the sun frame's at `f`. */
  const spanOf = (f: number, sign: number, at: number) => {
    let lo = 0,
      hi = 0;
    for (let k = 0; k < 3; k++) {
      const c = sign * levels.frame[f + k],
        a = c * grown[k],
        b = c * grown[k + 3];
      lo += Math.min(a, b);
      hi += Math.max(a, b);
    }
    span[at] = lo;
    span[at + 1] = hi;
  };
  const reader: DemandLight & {
    aim(at: number, first: number, mark: (entry: number) => void): DemandLight;
  } = {
    aim(at, first, mark) {
      slice = at;
      base = first;
      marked = mark;
      return reader;
    },
    reaches: () => true,
    levels(_box, _o, fine, coarse, out) {
      const finest = levels.finest[slice];
      out[0] = Math.max(Math.floor(Math.log2(fine)), finest);
      out[1] = Math.min(Math.floor(Math.log2(coarse)), finest + SUN_LEVELS - 1);
    },
    pageSide: (_box, _o, level) => sunPageMetres(level),
    mark(box, o, level, margin) {
      growBox(box, o, margin * 2 ** level, grown);
      spanOf(slice * 9, 1, 0);
      spanOf(slice * 9 + 3, -1, 2);
      const page = sunPageMetres(level);
      const ox = levels.originOf(slice, level, 0),
        oy = levels.originOf(slice, level, 1);
      const u0 = Math.floor(span[0] / page),
        u1 = Math.floor(span[1] / page),
        v0 = Math.floor(span[2] / page),
        v1 = Math.floor(span[3] / page);
      const x0 = Math.max(ox, u0),
        x1 = Math.min(ox + SUN_WINDOW - 1, u1),
        y0 = Math.max(oy, v0),
        y1 = Math.min(oy + SUN_WINDOW - 1, v1);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) marked(base + sunEntry(level, x, y));
      // A point past this level's extent reads the next level: the box is read there too.
      const past = x0 > u0 || x1 < u1 || y0 > v0 || y1 < v1;
      if (past && level < levels.finest[slice] + SUN_LEVELS - 1)
        reader.mark(box, o, level + 1, margin);
    },
  };
  return reader;
}
