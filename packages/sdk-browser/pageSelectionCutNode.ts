import {
  errorFloorAt,
  projectedErrorAt,
  viewDepth,
  viewLateral,
} from './pageSelectionProjection.ts';
import type { PageRecord, SelectionState } from './pageSelectionCutState.ts';
import {
  ALL_SOURCED,
  OWN_CEIL,
  OWN_FLOOR,
  OWN_SPHERE,
  PARENT_FLOOR,
  PARENT_SPHERE,
} from './pageSelectionCutBounds.ts';

/**
 * Cut decision of a whole subtree: -1 reject, 1 accept, 0 undecided.
 *
 * The per-cluster test keeps a cluster fine enough that its replacement no longer covers it.
 * The two members bound separately: a ceiling under the threshold holds for the whole subtree,
 * a floor above the threshold too. Rejecting requires one of the two members to be false
 * everywhere, accepting that both be true everywhere; in between one descends, and the returned
 * decision is the one the full descent would have returned.
 *
 * The own-error floor and ceiling share the depth of the same sphere; the distance to the axis,
 * and its square root, is taken only if the floor has not already rejected, and the
 * replacement's sphere is projected only if the decision still depends on it.
 *
 * The reject the manifest already allows — no replacement still too coarse in the subtree —
 * remains set by the caller, with the manifest bounds and on both passes.
 */
export function nodeDecision<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
) {
  const limit = s.pixelError,
    e = s.flatElements,
    stretch = s.flatStretch,
    focal = s.flatFocal,
    perspective = s.cam.perspective;
  const ownRadius = values[at + OWN_SPHERE + 3],
    ownDepth = viewDepth(values, at + OWN_SPHERE, e);
  // No cluster of the subtree is fine enough: the cut takes none of them.
  const floor = errorFloorAt(
    values[at + OWN_FLOOR],
    ownDepth,
    ownRadius,
    stretch,
    focal,
    perspective,
  );
  if (floor > limit) return -1;
  // A cluster may still be too coarse: one descends.
  const ownCeil = projectedErrorAt(
    values[at + OWN_CEIL],
    viewLateral(values, at + OWN_SPHERE, e),
    ownDepth,
    ownRadius,
    stretch,
    focal,
    s.cam.near,
    perspective,
  );
  if (ownCeil > limit) return 0;
  // All are fine enough; the cut keeps them if no replacement still covers them.
  return errorFloorAt(
    values[at + PARENT_FLOOR],
    viewDepth(values, at + PARENT_SPHERE, e),
    values[at + PARENT_SPHERE + 3],
    stretch,
    focal,
    perspective,
  ) > limit
    ? 1
    : 0;
}

/** Is a subtree's floor strictly positive, without projecting it? See `nodeDecisionAtZero`. */
function floorAboveZero(values: Float64Array, error: number, radiusAt: number) {
  return error === Infinity || (error > 0 && values[radiusAt] >= 0);
}

/**
 * `nodeDecision` when the threshold is zero, without projecting anything.
 *
 * Same identity as `cutSelectsAtZero`: a projected error is never negative, so "> 0" equals
 * "≠ 0", and both bounds return zero only on a null error — or, for the floor, on a missing
 * sphere, which certifies nothing. The ceiling, for its part, only goes under zero if it is
 * zero. A node's decisions at a null threshold therefore depend neither on the camera nor on
 * the spheres, but only on the bounds preparation reduced. The caller takes this path only when
 * the frame's stretch, focal length and near plane are finite and strictly positive.
 *
 * The identity holds under the invariant that `cullingBounds` maintains and that
 * `pageSelectionCutNode.test.ts` checks: a finite strictly positive bound comes from a cluster
 * that carried its sphere, hence a positive or zero radius. On a positive bound without a
 * sphere — which preparation does not produce — the general path would refuse the datum where
 * this one descends.
 */
export function nodeDecisionAtZero(values: Float64Array, at: number) {
  if (floorAboveZero(values, values[at + OWN_FLOOR], at + OWN_SPHERE + 3)) return -1;
  if (values[at + OWN_CEIL] !== 0) return 0;
  return floorAboveZero(values, values[at + PARENT_FLOOR], at + PARENT_SPHERE + 3) ? 1 : 0;
}

/**
 * Decision of a subtree for the current pass: -1 reject, 1 accept, 0 undecided.
 *
 * The caller only calls it, under fallback by forcing, on a subtree that no forced group
 * touches. There, `forced[source]` and `forced[group]` are false everywhere, and
 * `drawnUnderForcing` reads "own error under the threshold, replacement above" — word for word
 * `cutSelects`, so both node bounds decide identically — with one exception: a cluster nothing
 * produced is drawn whatever its own error. Reject, which rests only on that error, therefore
 * also requires the whole subtree to have a producing group; accept, which rests only on the
 * own ceiling and the replacement floor, has nothing more to ask.
 */
export function subtreeDecision<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
  exact: boolean,
  forcing: boolean,
) {
  const decision = exact ? nodeDecisionAtZero(values, at) : nodeDecision(s, values, at);
  if (decision < 0 && forcing && values[at + ALL_SOURCED] === 0) return 0;
  return decision;
}
