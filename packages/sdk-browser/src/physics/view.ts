import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { resolveCameraWorld } from '../camera/world.ts';

/**
 * The page's view as the simulation needs it (`VIEW`, `layout.ts`): distance decides what is
 * simulated — the range is the camera's draw distance (`camera.far`), the scene's own, never a
 * constant —, the view cone decides what is sent back. The pose is read through the camera
 * contract (`camera/world.ts`), and written only when it changed.
 */
export function createPhysicsView() {
  /** Eye (3), facing (3), half cone, range: as last sent. */
  const last = new Float64Array(8).fill(NaN),
    now = new Float64Array(8);
  return (camera: Camera, writer: CommandWriter) => {
    const w = resolveCameraWorld(camera).matrixWorld.elements;
    // The eye is the world matrix's translation; the camera looks down its own −z.
    const length = Math.hypot(w[8], w[9], w[10]) || 1;
    now[0] = w[12];
    now[1] = w[13];
    now[2] = w[14];
    for (let k = 0; k < 3; k++) now[3 + k] = -w[8 + k] / length;
    now[6] =
      camera.projection === 'perspective'
        ? Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.hypot(1, camera.aspect))
        : 0;
    now[7] = camera.far;
    let same = true;
    for (let k = 0; k < 8; k++) same &&= now[k] === last[k];
    if (same) return;
    last.set(now);
    writer.view(now.subarray(0, 3), now.subarray(3, 6), now[6], now[7]);
  };
}
