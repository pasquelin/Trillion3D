import type { Explorer } from '../../packages/sdk-browser/index.ts';
import type { SceneLight } from '../../packages/sdk/index.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';

function lightFor(kind: string | undefined, state: Record<string, number>): SceneLight {
  if (kind === 'point')
    return {
      id: 'lesson',
      kind,
      position: [0, 4, 2],
      color: [1, 0.72, 0.42],
      intensity: state.intensity,
      range: state.range,
      emitterRadius: 0.1,
      castsShadow: true,
    };
  if (kind === 'spot')
    return {
      id: 'lesson',
      kind,
      position: [0, 5, 4],
      direction: [0, -0.8, -0.6],
      color: [0.55, 0.75, 1],
      intensity: state.intensity,
      range: 12,
      coneAngle: (state.cone * Math.PI) / 180,
      emitterRadius: 0.1,
      castsShadow: true,
    };
  const angle = ((state.angle ?? -35) * Math.PI) / 180;
  return {
    id: 'lesson',
    kind: 'directional',
    direction: [Math.sin(angle), -0.8, Math.cos(angle)],
    color: [1, 0.92, 0.78],
    intensity: state.intensity ?? 2.5,
    castsShadow: true,
  };
}

export function applyRendererLesson(
  explorer: Explorer,
  lesson: RendererLessonItem,
  state: Record<string, number>,
  added: { value: boolean },
) {
  if (['point', 'spot', 'directional', 'exposure'].includes(lesson.kind ?? '')) {
    const light = lightFor(lesson.kind === 'exposure' ? 'directional' : lesson.kind, state);
    if (added.value) {
      const { id, ...patch } = light;
      explorer.setLight(id, patch);
    } else {
      explorer.addLight(light);
      added.value = true;
    }
  }
  if (lesson.kind === 'exposure') explorer.setEnvironment({ exposure: state.exposure });
  if (lesson.kind === 'lod') explorer.setPixelError(state.pixelError);
  if (lesson.kind === 'lod-diagnostic') {
    explorer.setPixelError(state.pixelError);
    explorer.setDiagnostic(state.showLevels === 1 ? 'lod' : 'beauty');
  }
  if (lesson.kind === 'memory')
    return explorer.setMemoryBudgets({ geometryPoolBytes: state.geometryMiB * 1024 * 1024 });
}
