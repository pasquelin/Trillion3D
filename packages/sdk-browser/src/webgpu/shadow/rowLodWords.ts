import { transformAffinePoint } from '../../../../sdk-core/src/index.ts';
import { worldStretch } from '../../page/cut/logic.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { Placements } from '../../page/selection/placements.ts';

/** Floats of a row's detail: its own error's world sphere centre and error, then its parent's. */
export const ROW_LOD_FLOATS = 8;
/** The error a row with no coarser form carries as its parent's, the largest float: every page
 *  wants finer. */
const NO_PARENT = 3.4e38;

const centre = new Float32Array(3);

/** The world centre of local sphere `sphere` and its world error `error`, at `out[at]`. */
function writeError(
  out: Float32Array,
  at: number,
  e: ArrayLike<number>,
  sphere: ArrayLike<number>,
  error: number,
) {
  transformAffinePoint(centre, e, sphere[0], sphere[1], sphere[2], 0);
  out.set(centre, at);
  out[at + 3] = error;
}

/**
 * Writes row `row`'s detail (#831): the world error of its own form and of the coarser one that
 * replaces it, each at its level-of-detail sphere's world centre, as the GPU cut projects them
 * (`../../gpu/dag/shader/error.ts`): the local error, grown by the placement's deformation reach
 * past the finest level, by the placement's stretch (`worldStretch`, the cut's own). The cut rule's residency is folded in
 * (`../../page/cut/rule.ts`): a row not `ready` carries a parent error of 0, so no page draws it;
 * one whose finer group is not ready (`childReady`), an own error of 0, so every page that reaches
 * it draws it. A row with no record — a blended caster's is given none — or of a cache without
 * errors is drawn by every page.
 */
export function writeRowLod(
  out: Float32Array,
  row: number,
  rec: PageRec | undefined,
  root: Placements[number] | undefined,
  ready = true,
  childReady = true,
) {
  const at = row * ROW_LOD_FLOATS;
  out.fill(0, at, at + ROW_LOD_FLOATS);
  out[at + 7] = NO_PARENT;
  if (!root || !rec?.sphere || rec.lodError === undefined) return;
  const e = root.world.elements,
    reach = 2 * (root.reach ?? 0),
    scale = worldStretch(root);
  const own = rec.lodError + ((rec.level ?? 0) > 0 ? reach : 0);
  writeError(out, at, e, rec.sphere, childReady ? own * scale : 0);
  const parent = rec.parentError ?? -1;
  if (!ready) out[at + 7] = 0;
  else if (parent >= 0 && rec.parentSphere)
    writeError(out, at + 4, e, rec.parentSphere, (parent + reach) * scale);
}
