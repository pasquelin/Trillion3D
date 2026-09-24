import { rotateByQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import { fixtureCamera, fixtureSurface, type FixtureCamera } from './controls.fixture.ts';
import type { SteeredCameraControls } from './types.ts';

/** Where the camera looks: its local -Z, turned by its orientation. */
export const facing = ({ quaternion: q }: Pick<FixtureCamera, 'quaternion'>) =>
  rotateByQuaternion(new Float64Array(3), [q.x, q.y, q.z, q.w], 0, 0, -1);

/** One camera, one surface and the named controller, with its emissions counted. */
export function steered<T extends SteeredCameraControls>(
  make: (camera: FixtureCamera, surface: HTMLElement) => T,
) {
  const camera = fixtureCamera(0, 0, 0),
    surface = fixtureSurface(400);
  const controls = make(camera, surface.element);
  let changes = 0;
  controls.addEventListener('change', () => changes++);
  return { camera, surface, controls, changes: () => changes };
}
