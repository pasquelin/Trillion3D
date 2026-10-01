import type { CutView } from '../../page/cut/viewSet.ts';
/** One conservative cell-index query enclosing every eye's asymmetric far corners. */
export function xrCellReach(views: readonly CutView[]) {
  const eye = [0, 0, 0];
  for (const view of views)
    for (let axis = 0; axis < 3; axis++) eye[axis] += view.camera.eye[axis] / views.length;
  let reach = 0;
  for (const { camera } of views) {
    const p = camera.projection;
    const x = (1 + Math.abs(p[8])) / Math.abs(p[0]),
      y = (1 + Math.abs(p[9])) / Math.abs(p[5]);
    const extent = camera.far * Math.sqrt(1 + x * x + y * y);
    reach = Math.max(
      reach,
      extent + Math.hypot(camera.eye[0] - eye[0], camera.eye[1] - eye[1], camera.eye[2] - eye[2]),
    );
  }
  return { eye, reach };
}
