import { lessonCode } from './lessonCode.ts';
import { lightingLessonCode } from './lightingLessonCode.ts';
import { cameraLessonCode } from './cameraLessonCode.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';
const line = (lesson: RendererLessonItem, state: Record<string, number>) => {
  if (lesson.kind === 'point')
    return `world.scene.add(light.point({ position: [0, 4, 2], color: [1, 0.72, 0.42], intensity: ${state.intensity}, distance: ${state.range}, castShadow: true }));`;
  if (lesson.kind === 'spot')
    return `world.scene.add(light.spot({ position: [0, 5, 4], target: [0, 1, 1], color: [0.55, 0.75, 1], intensity: ${state.intensity}, distance: 12, angle: ${state.cone} * Math.PI / 180, castShadow: true }));`;
  if (lesson.kind === 'directional')
    return `const angle = ${state.angle} * Math.PI / 180;
world.scene.add(light.directional({ position: [Math.sin(angle) * -10, 8, Math.cos(angle) * -10], target: [0, 0, 0], color: [1, 0.92, 0.78], intensity: ${state.intensity}, castShadow: true }));`;
  if (lesson.kind === 'exposure')
    return `world.exposure = ${state.exposure};
world.scene.add(light.directional({ position: [4.8, 9.6, 3.6], target: [0, 0, 0], color: [1, 0.92, 0.78], intensity: 2.5, castShadow: true }));`;
  if (lesson.kind === 'lod-diagnostic')
    return `world.pixelError = ${state.pixelError};
world.diagnostic.mode = ${state.showLevels === 1 ? "'clusters'" : "'beauty'"};`;
  return `world.budget.geometryPool = ${state.geometryMiB} * 1024 * 1024;`;
};

export function rendererCodeFor(lesson: RendererLessonItem, state: Record<string, number>) {
  if (lesson.kind === 'offline') return lessonCode('', { manifest: lesson.manifest });
  if (lesson.runtime === 'advanced-lighting') return lightingLessonCode(lesson, state);
  if (lesson.runtime === 'camera-pose') return cameraLessonCode(lesson, state);
  return lessonCode(line(lesson, state), {
    manifest: lesson.manifest,
    sceneLight: lesson.sceneLight,
    sceneFill: lesson.sceneFill,
    initialPose: lesson.initialPose,
  });
}
