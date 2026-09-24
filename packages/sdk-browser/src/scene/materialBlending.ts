/**
 * How a surface composes over what is behind it, read once at the boundary into the engine's own
 * names (`Blending`), and the one blend equation each name stands for on both GPU paths.
 *
 * The equations are written once, in the WebGPU vocabulary; the WebGL2 cluster state maps the
 * same factors to its own enums (`../webgl/cluster/state.ts`), so the two paths cannot drift.
 * In linear light, with `s` the source colour, `a` its opacity and `d` what the target holds:
 * normal is `s·a + d·(1 − a)`, additive `d + s·a`, subtractive `d − s·a`, multiply `d·s`, and
 * none writes `s` as it is. A custom equation is not a mode the engine draws.
 */
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts';
import {
  HOST_BLENDING_ADDITIVE,
  HOST_BLENDING_MULTIPLY,
  HOST_BLENDING_NONE,
  HOST_BLENDING_NORMAL,
  HOST_BLENDING_SUBTRACTIVE,
} from '../host/surfaceConstants.ts';

/** Every mode the engine draws, in the rank the transparent pass gives its pipelines: normal
 *  first, so a transmissive entry, which blends by its backdrop, indexes the first three. */
export const BLEND_MODES: readonly Blending[] = [
  'normal',
  'additive',
  'subtractive',
  'multiply',
  'none',
];

const HOST: Record<Blending, number> = {
  none: HOST_BLENDING_NONE,
  normal: HOST_BLENDING_NORMAL,
  additive: HOST_BLENDING_ADDITIVE,
  subtractive: HOST_BLENDING_SUBTRACTIVE,
  multiply: HOST_BLENDING_MULTIPLY,
};

/** The host constant for a mode the engine names: the way in, for a boundary that builds one. */
export const hostBlending = (blending: Blending): number => HOST[blending];

/** The mode a host constant stands for; an undeclared one is the host default, normal, and one
 *  the engine has no name for is `undefined`, which every reader refuses by name. */
export function blendingOf(host: number | undefined): Blending | undefined {
  if (host === undefined) return 'normal';
  return BLEND_MODES.find((mode) => HOST[mode] === host);
}

/** A mode that adds to, takes from or filters the background: it means nothing drawn opaque, so
 *  a surface declaring one is drawn in the transparent pass. */
export const composesWithBackground = (blending: Blending) =>
  blending === 'additive' || blending === 'subtractive' || blending === 'multiply';

/** The target keeps its own alpha under every mode but normal: only the colour composes. */
const KEEP_ALPHA: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one', operation: 'add' };

/** The equation of each mode; `undefined` is no blending at all — the source replaces the target. */
export const BLEND_EQUATIONS: Record<Blending, GPUBlendState | undefined> = {
  normal: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  },
  additive: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: KEEP_ALPHA,
  },
  subtractive: {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'reverse-subtract' },
    alpha: KEEP_ALPHA,
  },
  multiply: {
    color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' },
    alpha: KEEP_ALPHA,
  },
  none: undefined,
};
