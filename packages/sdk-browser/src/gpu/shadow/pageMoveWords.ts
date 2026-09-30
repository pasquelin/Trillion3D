import { SHADOW_PAGE, pageOrigin } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Words of one move: where the page was — its first texel, its layer, the page's texels a side —,
 *  then where it goes, the target's texels a side last. */
export const MOVE_WORDS = 8;

/** The moves of every page `moved` names (`resizeShadowPool`), from a pool of `fromSide` pages a
 *  side to one of `toSide`, at `scale` of the pool's texels — ½ for the transmittance layer —, in
 *  the order of their target pages, so each target layer's moves are one run. */
export function shadowPageMoves(moved: Int32Array, fromSide: number, toSide: number, scale = 1) {
  const words: number[] = [],
    page = SHADOW_PAGE * scale;
  for (const [was, now] of moved.entries()) {
    if (now < 0) continue;
    const from = pageOrigin(was, fromSide),
      to = pageOrigin(now, toSide);
    words.push(from.x * scale, from.y * scale, from.layer, page);
    words.push(to.x * scale, to.y * scale, to.layer, toSide * page);
  }
  return Uint32Array.from(words);
}
