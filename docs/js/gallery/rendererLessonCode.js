import { lessonCode } from './lessonCode.js';
import { lightingLessonCode } from './lightingLessonCode.js';
import { cameraLessonCode } from './cameraLessonCode.js';
const line = (lesson, state) => {
  if (lesson.kind === 'point')
    return `explorer.addLight({ id: 'lesson', kind: 'point', position: [0, 4, 2], color: [1, 0.72, 0.42], intensity: ${state.intensity}, range: ${state.range}, emitterRadius: 0.1, castsShadow: true });`;
  if (lesson.kind === 'spot')
    return `explorer.addLight({ id: 'lesson', kind: 'spot', position: [0, 5, 4], direction: [0, -0.8, -0.6], color: [0.55, 0.75, 1], intensity: ${state.intensity}, range: 12, coneAngle: ${state.cone} * Math.PI / 180, emitterRadius: 0.1, castsShadow: true });`;
  if (lesson.kind === 'directional')
    return `const angle = ${state.angle} * Math.PI / 180;
explorer.addLight({ id: 'lesson', kind: 'directional', direction: [Math.sin(angle), -0.8, Math.cos(angle)], color: [1, 0.92, 0.78], intensity: ${state.intensity}, castsShadow: true });`;
  if (lesson.kind === 'exposure')
    return `explorer.addLight({ id: 'lesson', kind: 'directional', direction: [-0.4, -0.8, -0.3], color: [1, 0.92, 0.78], intensity: 2.5, castsShadow: true });
explorer.setEnvironment({ exposure: ${state.exposure} });`;
  if (lesson.kind === 'lod') return `explorer.setPixelError(${state.pixelError});`;
  return `await explorer.setMemoryBudgets({ geometryPoolBytes: ${state.geometryMiB} * 1024 * 1024 });`;
};

export function rendererCodeFor(lesson, state) {
  if (lesson.kind === 'offline') return lessonCode('', { manifest: lesson.manifest });
  if (lesson.runtime === 'advanced-lighting') return lightingLessonCode(lesson, state);
  if (lesson.runtime === 'camera-pose') return cameraLessonCode(lesson, state);
  return lessonCode(line(lesson, state), {
    manifest: lesson.manifest,
    importedLights: lesson.importedLights,
    sceneLight: lesson.sceneLight,
    sceneFill: lesson.sceneFill,
  });
}
