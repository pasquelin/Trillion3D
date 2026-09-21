const scaledPosition = (pose, scale) =>
  pose.target.map((target, index) => target + (pose.position[index] - target) * scale);

export function cameraPoseFor(explorer, lesson, state) {
  const home = explorer.homePose();
  if (lesson.mode === 'dolly') return { ...home, position: scaledPosition(home, state.distance) };
  if (lesson.mode === 'fov') return { ...home, fov: state.fov };
  if (lesson.mode === 'near') return { ...home, near: state.near };
  const angle = (state.angle * Math.PI) / 180,
    offset = home.position.map((value, index) => value - home.target[index]),
    radius = Math.hypot(offset[0], offset[2]);
  // An orbit keeps the eye's height unless the lesson sets it: the occlusion lesson lowers it to
  // ring height, where the rings of a row hide one another.
  return {
    ...home,
    position: [
      home.target[0] + Math.sin(angle) * radius,
      state.height ?? home.position[1],
      home.target[2] + Math.cos(angle) * radius,
    ],
  };
}

export function applyCameraLesson(explorer, lesson, state) {
  explorer.setPose(cameraPoseFor(explorer, lesson, state));
}
