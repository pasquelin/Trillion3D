import type { EvaluationResult } from '../../site/lessons/evaluate.ts';

/** Picks the field of `result` the playground displays for `id`, narrowed by structural
 * presence (`in`) rather than a cast: `EvaluationResult` is a union and each id only ever
 * produces the matching member. */
export function expectedResultFor(id: string, result: EvaluationResult) {
  switch (id) {
    case 'compose-transform':
      return 'points' in result ? result.points[2] : undefined;
    case 'matrix-chain':
    case 'hierarchy':
      return 'point' in result ? result.point : undefined;
    case 'matrix-inverse':
      return 'identity' in result ? result.identity : undefined;
    case 'reflection-orientation':
      return 'determinant' in result && 'linear' in result
        ? [result.determinant, result.linear]
        : undefined;
    case 'quaternion-turn':
      return 'direction' in result ? result.direction : undefined;
    case 'normal-transform':
      return 'normal' in result ? result.normal : undefined;
    case 'perspective':
      return 'ndc' in result ? result.ndc : undefined;
    case 'frustum':
      return 'status' in result ? result.status : undefined;
    case 'dot-product':
      return 'dot' in result ? result.dot : undefined;
    case 'cross-product':
      return 'cross' in result ? result.cross : undefined;
    case 'normalize':
      return 'after' in result ? result.after : undefined;
    case 'box-grow':
      return 'box' in result ? result.box : undefined;
    case 'sphere-from-box':
      return 'sphere' in result ? result.sphere : undefined;
    case 'color-space':
      return 'screen' in result && 'light' in result ? [result.screen, result.light] : undefined;
    case 'lod-budget':
      return 'error' in result ? result.error : undefined;
    default:
      return undefined;
  }
}
