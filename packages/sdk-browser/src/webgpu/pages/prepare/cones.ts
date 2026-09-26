import { OPEN_CONE } from '../../../page/cone/cone.ts';
import { surfaceFrontOnly } from '../../../page/surface.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Every collected cluster carries the cone the compiler cooked (`Page.cone`); this prepare decides
 *  which ones the cut may read. Posting a cone is declaring it: the page's root raises its flag, or
 *  the cut would believe it has no cone and would no longer read `cone`. A cluster whose indices
 *  are not held yet keeps none, as when its cone was built here from them: giving it one would
 *  change which clusters the cut requests, a change of its own (#272). */
export function prepareCones(rt: WebgpuPagesRuntime) {
  for (const root of rt.setup.roots)
    for (const rec of root.pages) {
      if (!rec.array) rec.cone = undefined;
      if (!rec.cone) continue;
      root.cones = true;
      // Front-only alone keeps a closed cone, and the side is read from the declaration at this
      // very moment: a surface the host later opens in place reopens its cone at the cut
      // (`../../../page/surface.ts`, `gpuSelection.leafCone`).
      if (!surfaceFrontOnly(rec.material)) rec.cone = OPEN_CONE;
    }
}
