import { lessonCode } from './lessonCode.js';
import { LESSON_POINT_INTENSITY } from './lightingLessonDefinitions.js';
const light = (id, position, color, intensity, emitterRadius = 0.1, castsShadow = true) =>
  `explorer.addLight({ id: '${id}', kind: 'point', position: [${position}], color: [${color}], intensity: ${intensity}, range: 10, emitterRadius: ${emitterRadius}, castsShadow: ${castsShadow} });`;

function operation(lesson, state) {
  if (lesson.kind === 'color-balance')
    return `${light('warm', '-3, 3, 2', '1, 0.35, 0.12', state.warm)}
${light('cool', '3, 3, 2', '0.12, 0.4, 1', state.cool)}`;
  if (lesson.kind === 'moving-point')
    return light('moving', `${state.x}, 4, 2`, '1, 0.8, 0.55', LESSON_POINT_INTENSITY);
  if (lesson.kind === 'shadow-switch')
    return `explorer.addLight({ id: 'switch', kind: 'point', position: [-3, 7, 10], color: [1, 0.72, 0.42], intensity: 1800, range: 30, emitterRadius: 0.1, castsShadow: ${state.shadow === 1} });`;
  if (lesson.kind === 'emitter-radius')
    return light('envelope', '0, 4, 2', '1, 0.8, 0.55', LESSON_POINT_INTENSITY, state.radius);
  const created = light('lifecycle', '0, 4, 2', '1, 0.8, 0.55', LESSON_POINT_INTENSITY);
  return state.enabled === 1 ? created : `${created}\nexplorer.removeLight('lifecycle');`;
}

export function lightingLessonCode(lesson, state) {
  return lessonCode(operation(lesson, state), {
    manifest: lesson.manifest,
    importedLights: lesson.importedLights,
    sceneFill: lesson.sceneFill,
    initialPose: lesson.initialPose,
  });
}
