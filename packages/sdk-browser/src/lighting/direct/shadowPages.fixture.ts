// `shadowPcf` near a page's edge, restated for #456: each tap split along the seam between the
// home page and its neighbours, each page read where the pool placed it. `SPLIT` holds the WGSL
// lines restated here; `shadowBias.test.ts` pins them.
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PAGES } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { POISSON_16 } from './pcfTaps.ts';
import { clampNumber as clamp } from '../../../../sdk-core/src/world/math/spherical.ts';
import { compare, litOf, pcf, type Stored } from './shadowBias.fixture.ts';

export type Pair = [number, number];

/** A deterministic value in [0, 1) per integer: a page's content in the tests of #831 and #26. */
export const hash = (x: number) => {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/** `shadowPcf`'s split of a tap along a page seam: what `pagedPcf` restates. */
export const SPLIT = [
  ' let edge=vec2i(shadowPcfEdge(t.x,first.x),shadowPcfEdge(t.y,first.y))>vec2i(0);',
  ' let step=vec2i(shadowPcfStep(t.x,first.x),shadowPcfStep(t.y,first.y));',
  ' let up=step>vec2i(0);',
  '  let h=clamp(at,first+0.5,first+SHADOW_PAGE-0.5);',
  '  let n=select(min(at,seam-0.5),max(at,seam+0.5),up);',
  '  let w=saturate(0.5+(seam-at)*toward);',
  '  var sum=w.x*w.y*shadowCompare(offset,h,reference);',
  ' if(word==0u||((word^homeWord)>>PAGE_RANGE_SHIFT)!=0u){return vec4f(home,0.0);}',
  '  if(edge.x){sum+=(1.0-w.x)*w.y*shadowCompare(nx.xyz,vec2f(select(h.x,n.x,nx.w>0.0),h.y),reference);}',
  '  if(edge.y){sum+=w.x*(1.0-w.y)*shadowCompare(ny.xyz,vec2f(h.x,select(h.y,n.y,ny.w>0.0)),reference);}',
  '  if(all(edge)){sum+=(1.0-w.x)*(1.0-w.y)*shadowCompare(nd.xyz,select(h,n,nd.w>0.0),reference);}',
];

/**
 * The PCF at map texel `t`, the pool holding page `(px, py)` at the atlas texel `placed(px, py)`
 * — or nowhere, not readable, as a page of another depth range than the home page's —, the atlas
 * storing `atlas(x, y)` at its texel centres.
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
  const edge = [0, 1].map((a) => PAGES.shadowPcfEdge(t[a], first[a]));
  if (!edge[0] && !edge[1]) return pcf([offset[0] + t[0], offset[1] + t[1]], atlas, reference);
  const step = [0, 1].map((a) => PAGES.shadowPcfStep(t[a], first[a])),
    up = step.map((s) => s > 0),
    seam = [0, 1].map((a) => first[a] + (up[a] ? S : 0));
  // `shadowNeighbour`: a neighbour's offset, undefined when it is not readable.
  const nx = edge[0] ? offsetOf([home[0] + step[0], home[1]]) : undefined,
    ny = edge[1] ? offsetOf([home[0], home[1] + step[1]]) : undefined,
    nd = edge[0] && edge[1] ? offsetOf([home[0] + step[0], home[1] + step[1]]) : undefined;
  let lit = 0;
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

/** `shadowThrough` on one axis at page-local texel `local`, in single precision as the GPU runs it:
 *  the transmittance layer's texel from the page's half-resolution origin, and its weight. */
export function throughAxis(local: number): Pair {
  const h = Math.fround(
    Math.min(Math.max(Math.fround(0.5 * local), 0.5), SHADOW_PAGE / 2 - 0.5) - 0.5,
  );
  return [Math.floor(h), Math.fround(h - Math.floor(h))];
}
