import { normalizeVector3, type ShadowViewpoint } from '../../../../../sdk-core/src/index.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { pixelNearOf } from '../../../streaming/priority.ts';

const viewpoint: ShadowViewpoint & {
  position: [number, number, number];
  forward: [number, number, number];
} = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.5,
  aspect: 1,
  near: 0.1,
  far: 1000,
  pixelNear: 1e-3,
};

/**
 * View the scheduler reads: position, axis, vertical half-fov, aspect, near and far planes, and
 * the pixel's footprint at the near plane. A sun's clipmap derives entirely from it — its windows
 * follow the camera, its finest level is that footprint's.
 */
export function shadowViewpointOf(cam: EngineCamera, height: number) {
  // Read in the world matrix image entry copied, ancestors included: the axis is that of
  // `Camera.getWorldDirection`, third column normalised then negated.
  const world = cam.world;
  const { position } = viewpoint;
  for (let i = 0; i < 3; i++) position[i] = cam.eye[i];
  // Negated, then normalised: the bits of the reverse order, a norm being blind to the sign.
  const forward = viewpoint.forward;
  for (let i = 0; i < 3; i++) forward[i] = -world[8 + i];
  normalizeVector3(forward);
  viewpoint.halfFovY = Math.max(1e-3, (cam.fov * Math.PI) / 360);
  viewpoint.aspect = Math.max(1e-3, cam.aspect);
  viewpoint.near = cam.near;
  viewpoint.far = cam.far;
  viewpoint.pixelNear = pixelNearOf(cam.projection, height, cam.near);
  return viewpoint;
}
