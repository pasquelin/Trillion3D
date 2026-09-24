import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';

const eye = new Vector3(),
  facing = new Vector3();

/**
 * The page's view as the simulation needs it (`VIEW`, `layout.ts`): distance decides what is
 * simulated — the range is the camera's draw distance (`camera.far`), the scene's own, never a
 * constant —, the view cone decides what is sent back. Written only when it changed.
 */
export function createPhysicsView() {
  const last = new Float64Array(8).fill(NaN);
  return (camera: Camera, writer: CommandWriter) => {
    camera.getWorldPosition(eye);
    camera.getWorldDirection(facing);
    const halfCone =
      camera.projection === 'perspective'
        ? Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.hypot(1, camera.aspect))
        : 0;
    const now = [eye.x, eye.y, eye.z, facing.x, facing.y, facing.z, halfCone, camera.far];
    if (now.every((value, i) => value === last[i])) return;
    last.set(now);
    writer.view(eye.elements, facing.elements, halfCone, camera.far);
  };
}
