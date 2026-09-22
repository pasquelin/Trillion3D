import { lessonCode } from './lessonCode.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';
function change(lesson: RendererLessonItem, state: Record<string, number>) {
  if (lesson.mode === 'dolly')
    return `home.position = home.target.map((value, index) => value + (home.position[index] - value) * ${state.distance});
world.camera.position.set(...home.position);
world.camera.lookAt(...home.target);`;
  if (lesson.mode === 'fov') return `world.camera.fov = ${state.fov};`;
  if (lesson.mode === 'near') return `world.camera.near = ${state.near};`;
  return `const angle = ${state.angle} * Math.PI / 180;
const dx = home.position[0] - home.target[0];
const dz = home.position[2] - home.target[2];
const radius = Math.hypot(dx, dz);
home.position = [home.target[0] + Math.sin(angle) * radius, ${state.height ?? 'home.position[1]'}, home.target[2] + Math.cos(angle) * radius];
world.camera.position.set(...home.position);
world.camera.lookAt(...home.target);`;
}

export function cameraLessonCode(lesson: RendererLessonItem, state: Record<string, number>) {
  return lessonCode(change(lesson, state), {
    manifest: lesson.manifest,
    importedLights: lesson.importedLights,
    sceneLight: lesson.sceneLight,
    sceneFill: lesson.sceneFill,
  });
}
