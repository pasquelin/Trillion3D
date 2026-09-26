import { OPEN_CONE } from '../../../page/cone/cone.ts';
import { surfaceFrontOnly } from '../../../page/surface.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Every cluster carries the cone the compiler cooked for it (`Page.cone`, `docs/FORMAT.md`); a
 *  double-sided or back-facing material keeps it open. Posting a cone is declaring it: the page's
 *  root raises its flag, or the cut would believe it has no cone and would no longer read `cone`.
 *  The cone is posted on the clusters whose indices are held at this moment, the ones it used to be
 *  built from here: posting it on a cluster still to stream would change which clusters the cut
 *  requests, a change of its own. */
export function prepareCones(rt: WebgpuPagesRuntime) {
  for (const root of rt.setup.roots)
    for (const rec of root.pages) {
      if (!rec.array || !rec.cookedCone) continue;
      root.cones = true;
      // Front-only alone gets a closed cone, and the side is read from the declaration at this
      // very moment: a surface the host later opens in place reopens its cone at the cut
      // (`../../../page/surface.ts`, `gpuSelection.leafCone`).
      rec.cone = surfaceFrontOnly(rec.material) ? rec.cookedCone : OPEN_CONE;
    }
}
