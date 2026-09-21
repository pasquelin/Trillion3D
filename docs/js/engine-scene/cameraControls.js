export function configureSceneCamera(explorer, controls) {
  let homeDistance = 1;
  const reset = () => {
    explorer.resetHome();
    controls.target.copy(explorer.center);
    homeDistance = Math.max(0.001, controls.object.position.distanceTo(explorer.center));
    controls.minDistance = homeDistance * 0.15;
    controls.maxDistance = homeDistance * 2.5;
    controls.update();
  };
  const zoom = (factor) => {
    const offset = controls.object.position.clone().sub(controls.target);
    const distance = Math.min(
      controls.maxDistance,
      Math.max(controls.minDistance, offset.length() * factor),
    );
    offset.setLength(distance);
    controls.object.position.copy(controls.target).add(offset);
    controls.update();
  };
  return { reset, zoomIn: () => zoom(0.8), zoomOut: () => zoom(1.25) };
}
