import { pixelScaleOf } from '../streaming/priority.ts';
import { worldStretch } from '../page/cut/logic.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';

type Roots = readonly ClusterRoot<PageRec>[];

/** How many pixels `reach` of root's units spans at worst, seen from `cam`: from the nearest point
 *  of its rest box the reach can bring closer. */
function pixelsOf(root: ClusterRoot<PageRec>, reach: number, cam: EngineCamera, focal: number) {
  const box = root.worldBox;
  if (!box) return Infinity;
  const world = reach * worldStretch(root);
  let squared = 0;
  for (let c = 0; c < 3; c++) {
    const gap = Math.max(0, box[c] - cam.eye[c], cam.eye[c] - box[c + 3]);
    squared += gap * gap;
  }
  const distance = Math.sqrt(squared) - world;
  return distance > cam.near ? (world * focal) / distance : Infinity;
}

/**
 * The screen-size threshold of the deformation stage (#357), as the reference skips a deformed
 * object too small to show it: `skippedBy(roots, cam, viewport, error)` gives the frame's
 * `skipped(i, reach)` (`frame.ts`), true when root `i`'s reach spans less than the image's pixel
 * error — it is then drawn at rest, as a coarser cluster would be. One closure, made once: a frame
 * allocates nothing.
 */
export function createDeformationSkip() {
  const scale: [number, number] = [1, 1];
  let roots: Roots = [],
    cam: EngineCamera | undefined,
    focal = 0,
    threshold = 0;
  const skipped = (i: number, reach: number) =>
    threshold > 0 && pixelsOf(roots[i], reach, cam!, focal) < threshold;
  return (
    frameRoots: Roots,
    frameCam: EngineCamera,
    viewport: readonly number[] | undefined,
    pixelError: number,
  ) => {
    roots = frameRoots;
    cam = frameCam;
    threshold = pixelError;
    pixelScaleOf(cam.projection, viewport, scale);
    focal = Math.max(scale[0], scale[1]);
    return skipped;
  };
}
