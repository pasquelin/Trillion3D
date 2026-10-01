import {
  planImpostors,
  type ImpostorPlan,
  type ImpostorSection,
} from '../../../../sdk-core/src/index.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { CutView } from '../../page/cut/viewSet.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';

/** A shared stereo cut may replace a root only when every eye accepts the existing card rule. */
export function constrainStereoImpostors(
  roots: readonly ClusterRoot<unknown>[],
  section: ImpostorSection,
  views: readonly CutView[] | undefined,
  plan: ImpostorPlan,
  scratch?: ImpostorPlan,
) {
  if (!views) return scratch;
  const pixels = [0, 0];
  for (const { camera, viewport } of views) {
    pixelScaleOf(camera.projection, viewport, pixels);
    scratch = planImpostors(roots, section, camera.view, Math.max(...pixels), scratch);
    for (let root = 0; root < plan.switched.length; root++)
      plan.switched[root] &= scratch.switched[root];
  }
  return scratch;
}
