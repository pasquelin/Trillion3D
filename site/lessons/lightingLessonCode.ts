import { lessonCode } from './lessonCode.ts';
import {
  LESSON_POINT_INTENSITY,
  LESSON_RING_INTENSITY,
  LESSON_RING_RANGE,
} from './lightingLessonDefinitions.ts';
import { ringLamps } from './lightingLessonRuntime.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';
const lamp = (
  variable: string,
  position: string,
  color: string,
  intensity: number,
  castShadow = true,
  distance = 10,
  radius?: number,
) =>
  `const ${variable} = light.point({ position: [${position}], color: [${color}], intensity: ${intensity}, distance: ${distance}, castShadow: ${castShadow}${radius === undefined ? '' : `, radius: ${radius}`} });
world.scene.add(${variable});`;

function operation(lesson: RendererLessonItem, state: Record<string, number>) {
  if (lesson.kind === 'color-balance')
    return `${lamp('warm', '-3, 3, 2', '1, 0.35, 0.12', state.warm)}
${lamp('cool', '3, 3, 2', '0.12, 0.4, 1', state.cool)}`;
  if (lesson.kind === 'moving-point')
    return lamp('moving', `${state.x}, 4, 2`, '1, 0.8, 0.55', LESSON_POINT_INTENSITY);
  if (lesson.kind === 'shadow-switch')
    return lamp('switchLamp', '-3, 7, 10', '1, 0.72, 0.42', 1800, state.shadow === 1, 30);
  if (lesson.kind === 'emitter-radius')
    return lamp('envelope', '0, 4, 2', '1, 0.8, 0.55', LESSON_POINT_INTENSITY, true, 10, state.radius);
  if (lesson.kind === 'many-lights')
    return ringLamps(state.count)
      .map((ring, index) =>
        lamp(
          `ring${index}`,
          ring.position.join(', '),
          ring.color.join(', '),
          LESSON_RING_INTENSITY,
          true,
          LESSON_RING_RANGE,
        ),
      )
      .join('\n');
  const created = lamp('lifecycle', '0, 4, 2', '1, 0.8, 0.55', LESSON_POINT_INTENSITY);
  return state.enabled === 1 ? created : `${created}\nworld.scene.remove(lifecycle);`;
}

export function lightingLessonCode(lesson: RendererLessonItem, state: Record<string, number>) {
  return lessonCode(operation(lesson, state), {
    manifest: lesson.manifest,
    sceneFill: lesson.sceneFill,
    initialPose: lesson.initialPose,
  });
}
