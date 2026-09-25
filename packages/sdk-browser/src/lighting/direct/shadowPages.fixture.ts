// `shadowPcf` near a page's edge, restated for #456: each tap split along the seam between the
// home page and its neighbours, each page read where the pool placed it. `shadowSeams.test.ts`
// pins the WGSL lines restated here.
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { POISSON_16 } from './shadowWgsl.ts';
import { clamp, compare, litOf, type Stored } from './shadowBias.fixture.ts';

type Pair = [number, number];

/**
 * The PCF at map texel `t`, the pool holding page `(px, py)` at the atlas texel `placed(px, py)`
 * — or nowhere, not readable —, the atlas storing `atlas(x, y)` at its texel centres.
 */
export function pagedPcf(
  t: Pair,
  reference: number,
  placed: (px: number, py: number) => Pair | undefined,
  atlas: Stored,
) {
  const S = SHADOW_PAGE,
    home = t.map((v) => Math.floor(v / S)) as Pair,
    first = home.map((p) => p * S);
  /** `shadowOffset`: added to a map texel of page `p`, its place in the atlas. */
  const offsetOf = (p: Pair) => {
    const at = placed(...p);
    return at && ([at[0] - p[0] * S, at[1] - p[1] * S] as Pair);
  };
  const offset = offsetOf(home)!;
  const cmp = (o: Pair, x: number, y: number) => compare(o[0] + x, o[1] + y, atlas, reference);
  const edge = [0, 1].map((a) => t[a] - 1.5 < first[a] || t[a] + 1.5 >= first[a] + S);
  let lit = 0;
  if (!edge[0] && !edge[1]) {
    for (const [dx, dy] of POISSON_16) lit += cmp(offset, t[0] + dx, t[1] + dy);
    return litOf(lit);
  }
  const up = [0, 1].map((a) => t[a] - first[a] >= 0.5 * S),
    step = up.map((u) => (u ? 1 : -1)),
    seam = [0, 1].map((a) => first[a] + (up[a] ? S : 0));
  // `shadowNeighbour`: a neighbour's offset, undefined when it is not readable.
  const nx = edge[0] ? offsetOf([home[0] + step[0], home[1]]) : undefined,
    ny = edge[1] ? offsetOf([home[0], home[1] + step[1]]) : undefined,
    nd = edge[0] && edge[1] ? offsetOf([home[0] + step[0], home[1] + step[1]]) : undefined;
  for (const tap of POISSON_16) {
    const at = [0, 1].map((a) => t[a] + tap[a]);
    const h = at.map((v, a) => clamp(v, first[a] + 0.5, first[a] + S - 0.5));
    const n = at.map((v, a) => (up[a] ? Math.max(v, seam[a] + 0.5) : Math.min(v, seam[a] - 0.5)));
    const w = at.map((v, a) => clamp(0.5 + (seam[a] - v) * step[a], 0, 1));
    let sum = w[0] * w[1] * cmp(offset, h[0], h[1]);
    if (edge[0]) sum += (1 - w[0]) * w[1] * cmp(nx ?? offset, nx ? n[0] : h[0], h[1]);
    if (edge[1]) sum += w[0] * (1 - w[1]) * cmp(ny ?? offset, h[0], ny ? n[1] : h[1]);
    if (edge[0] && edge[1])
      sum += (1 - w[0]) * (1 - w[1]) * cmp(nd ?? offset, nd ? n[0] : h[0], nd ? n[1] : h[1]);
    lit += sum;
  }
  return litOf(lit);
}
