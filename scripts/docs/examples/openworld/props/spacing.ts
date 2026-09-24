/**
 * Points spread over a periodic square — its opposite edges meet, so squares of them tile
 * without a seam: stems evenly spread, and the gaps between them for an understory.
 */
import { hash01 } from './noise.ts';

/**
 * Candidates tried per stem: each stem takes, of this many random spots, the one farthest from
 * the stems already there (best-candidate sampling, D. P. Mitchell, "Spectrally optimal
 * sampling for distribution ray tracing", SIGGRAPH 1991) — evenly spread, never on a grid.
 */
const CANDIDATES = 10;

/** Distance across a periodic square `side` wide: its opposite edges meet. */
function wrapped(side: number, [ax, az]: readonly number[], [bx, bz]: readonly number[]) {
  const wrap = (d: number) => d - side * Math.round(d / side);
  return Math.hypot(wrap(ax - bx), wrap(az - bz));
}

/** `count` stems spread by best candidate over a periodic square `side` wide. */
export function spread(side: number, count: number, seed: number) {
  const points: number[][] = [];
  for (let n = 0; n < count; n++) {
    let best: number[] = [],
      far = -1;
    for (let c = 0; c < CANDIDATES; c++) {
      const p = [(hash01(seed, n, c) - 0.5) * side, (hash01(seed + 1, n, c) - 0.5) * side],
        d = Math.min(Infinity, ...points.map((q) => wrapped(side, p, q)));
      if (d > far) [best, far] = [p, d];
    }
    points.push(best);
  }
  return points;
}

/** Spots in the gaps: as many as keep `gap` from every stem and each other, up to `count`. */
export function gaps(side: number, count: number, gap: number, seed: number, stems: number[][]) {
  const points: number[][] = [];
  for (let n = 0; points.length < count && n < count * 20; n++) {
    const p = [(hash01(seed, n, 1) - 0.5) * side, (hash01(seed, n, 2) - 0.5) * side];
    if ([...stems, ...points].every((q) => wrapped(side, p, q) >= gap)) points.push(p);
  }
  return points;
}
