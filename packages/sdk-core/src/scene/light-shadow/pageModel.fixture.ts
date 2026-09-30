import { SHADOW_PAGE } from './virtual.ts';
import { PAGES } from './pageModel.ts';

/** The pages the PCF around map texel `t` reads, its home page `home` first: the neighbours
 *  across the one or two edges it comes near (`shadowPcf`). */
export function pcfPages(t: ArrayLike<number>, home: ArrayLike<number>) {
  const first = [home[0] * SHADOW_PAGE, home[1] * SHADOW_PAGE],
    edge = [0, 1].map((a) => PAGES.shadowPcfEdge(t[a], first[a])),
    step = [0, 1].map((a) => PAGES.shadowPcfStep(t[a], first[a]));
  const read = [[home[0], home[1]]];
  if (edge[0]) read.push([home[0] + step[0], home[1]]);
  if (edge[1]) read.push([home[0], home[1] + step[1]]);
  if (edge[0] && edge[1]) read.push([home[0] + step[0], home[1] + step[1]]);
  return read;
}

/** First entry of `mip` inside a lamp face. */
export const lampMipOffset = (mip: number) => PAGES.shadowLampMapEntry(0, mip);
