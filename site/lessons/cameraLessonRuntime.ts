import type { CameraPose, World } from '../../packages/sdk-browser/src/index.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';

// `Array.isArray` does not narrow a readonly tuple cleanly against the object half of
// `Vec3Input`, so the shape is read by its own field instead.
const toArray = (v: CameraPose['position']): [number, number, number] =>
  'x' in v ? [v.x, v.y, v.z] : [v[0], v[1], v[2]];

const scaledPosition = (home: CameraPose, scale: number): [number, number, number] => {
  const position = toArray(home.position),
    target = toArray(home.target);
  return target.map((value, index) => value + (position[index] - value) * scale) as [
    number,
    number,
    number,
  ];
};

/** A camera lesson's pose, computed from the world's own home framing: the near-plane lesson has
 *  no counterpart on `CameraPose` and is applied straight on `world.camera` instead. */
export function cameraPoseFor(
  home: CameraPose,
  lesson: RendererLessonItem,
  state: Record<string, number>,
): CameraPose {
  if (lesson.mode === 'dolly') return { ...home, position: scaledPosition(home, state.distance) };
  if (lesson.mode === 'fov') return { ...home, fov: state.fov };
  if (lesson.mode === 'near') return home;
  const position = toArray(home.position),
    target = toArray(home.target),
    angle = (state.angle * Math.PI) / 180,
    offset = position.map((value, index) => value - target[index]),
    radius = Math.hypot(offset[0], offset[2]);
  // An orbit keeps the eye's height unless the lesson sets it: the occlusion lesson lowers it to
  // ring height, where the rings of a row hide one another.
  return {
    ...home,
    position: [
      target[0] + Math.sin(angle) * radius,
      state.height ?? position[1],
      target[2] + Math.cos(angle) * radius,
    ],
  };
}

export function applyCameraLesson(
  world: World,
  home: CameraPose,
  lesson: RendererLessonItem,
  state: Record<string, number>,
) {
  if (lesson.mode === 'near') {
    world.camera.near = state.near;
    return;
  }
  const pose = cameraPoseFor(home, lesson, state),
    position = toArray(pose.position),
    target = toArray(pose.target);
  world.camera.position.set(...position);
  world.camera.lookAt(...target);
  if (pose.fov !== undefined) world.camera.fov = pose.fov;
}
