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
  const last = new Float64Array(8).fill(NaN);
  return (camera: Camera, writer: CommandWriter) => {
    const w = resolveCameraWorld(camera).matrixWorld.elements;
    // The eye is the world matrix's translation; the camera looks down its own −z.
    const eye = [w[12], w[13], w[14]];
    const length = Math.hypot(w[8], w[9], w[10]) || 1;
    const facing = [-w[8] / length, -w[9] / length, -w[10] / length];
    const halfCone =
      camera.projection === 'perspective'
        ? Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.hypot(1, camera.aspect))
        : 0;
    const now = [...eye, ...facing, halfCone, camera.far];
    if (now.every((value, i) => value === last[i])) return;
    last.set(now);
    writer.view(eye, facing, halfCone, camera.far);
  };
}
