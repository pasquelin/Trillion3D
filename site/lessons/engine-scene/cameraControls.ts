import type { pose as poseFamily, Box3, World } from '../../../packages/sdk-browser/index.ts';

/** Reset and zoom for a mounted scene: the world keeps its own orbit controls live on
 *  `world.camera`, so zoom reads its current position rather than a separate controls handle.
 *  `pose` is the caller's: a static import here would pull the engine into every route that
 *  reaches this module, even one that never mounts a world. */
export function configureSceneCamera(pose: typeof poseFamily, world: World, bounds: Box3) {
  const target = bounds.getCenter();
  let homeDistance = 1;
  const reset = () => {
    const home = pose.fromBounds(bounds);
    world.camera.set(home);
    // `Array.isArray` does not narrow a readonly tuple cleanly against the object half of
    // `Vec3Input`, so the shape is read by its own field instead.
    const t = home.target;
    if ('x' in t) world.controls.target.set(t.x, t.y, t.z);
    else world.controls.target.set(t[0], t[1], t[2]);
    homeDistance = Math.max(0.001, world.camera.position.clone().sub(target).length());
  };
  const zoom = (factor: number) => {
    const offset = world.camera.position.clone().sub(target),
      distance = Math.min(
        homeDistance * 2.5,
        Math.max(homeDistance * 0.15, offset.length() * factor),
      );
    offset.normalize().multiplyScalar(distance);
    world.camera.position.copy(target).add(offset);
    world.camera.lookAt(target.x, target.y, target.z);
  };
  return { reset, zoomIn: () => zoom(0.8), zoomOut: () => zoom(1.25) };
}
