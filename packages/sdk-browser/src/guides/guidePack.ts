import type { GuidePiece } from './guideObject.ts';

/** Floats of one drawn instance: two ends, the packed colour, the width in pixels. */
export const GUIDE_INSTANCE_FLOATS = 8;

/** One guide a page drew: its pieces, what the ceiling counts of it, its pose and visibility. */
export interface GuideEntry {
  pieces: GuidePiece[];
  vertices: number;
  matrix: Float64Array;
  visible: boolean;
}

/**
 * The visible guides as instances (`GUIDE_INSTANCE_FLOATS` each): world positions taken relative
 * to `anchor` — the first visible guide's origin — in double precision, so the single-precision
 * upload keeps the detail of a guide far from the world's origin.
 */
export function packGuides(entries: Iterable<GuideEntry>) {
  const shown = [...entries].filter((entry) => entry.visible);
  let count = 0;
  for (const entry of shown) for (const piece of entry.pieces) count += piece.ends.length / 6;
  const data = new Float32Array(count * GUIDE_INSTANCE_FLOATS),
    words = new Uint32Array(data.buffer),
    anchor = new Float64Array(3);
  if (shown.length) anchor.set(shown[0].matrix.subarray(12, 15));
  let at = 0;
  for (const { matrix: m, pieces } of shown)
    for (const { ends, color, width } of pieces)
      for (let s = 0; s < ends.length; s += 6, at += GUIDE_INSTANCE_FLOATS) {
        for (let e = 0; e < 6; e += 3) {
          const [x, y, z] = [ends[s + e], ends[s + e + 1], ends[s + e + 2]];
          for (let c = 0; c < 3; c++)
            data[at + e + c] = m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c] - anchor[c];
        }
        // Bytes r, g, b, a in memory order: what `unorm8x4` and `UNSIGNED_BYTE` read.
        words[at + 6] =
          ((color >> 16) & 255) | (color & 0xff00) | ((color & 255) << 16) | (255 << 24);
        data[at + 7] = width;
      }
  return { data, count, anchor };
}
