import type {
  light as lightFamily,
  LightParameters,
  Light,
  World,
} from '../../packages/sdk-browser/index.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';

function paramsFor(kind: string | undefined, state: Record<string, number>): LightParameters {
  if (kind === 'point')
    return {
      position: [0, 4, 2],
      color: [1, 0.72, 0.42],
      intensity: state.intensity,
      distance: state.range,
      castShadow: true,
    };
  if (kind === 'spot')
    return {
      position: [0, 5, 4],
      target: [0, 1, 1],
      color: [0.55, 0.75, 1],
      intensity: state.intensity,
      distance: 12,
      angle: (state.cone * Math.PI) / 180,
      castShadow: true,
    };
  const angle = ((state.angle ?? -35) * Math.PI) / 180;
  return {
    position: [Math.sin(angle) * -10, 8, Math.cos(angle) * -10],
    target: [0, 0, 0],
    color: [1, 0.92, 0.78],
    intensity: state.intensity ?? 2.5,
    castShadow: true,
  };
}

/** One lesson light, added on the first update and mutated in place after: the new surface has no
 *  per-id light store, so the session keeps the live `Light` object it made. */
export function applyRendererLesson(
  light: typeof lightFamily,
  world: World,
  lesson: RendererLessonItem,
  state: Record<string, number>,
  session: { current: Light | undefined },
) {
  if (['point', 'spot', 'directional', 'exposure'].includes(lesson.kind ?? '')) {
    const params = paramsFor(lesson.kind === 'exposure' ? 'directional' : lesson.kind, state);
    if (!session.current) {
      session.current =
        lesson.kind === 'point'
          ? light.point(params)
          : lesson.kind === 'spot'
            ? light.spot(params)
            : light.directional(params);
      world.scene.add(session.current);
    } else {
      session.current.color.set(params.color!);
      session.current.intensity = params.intensity!;
      session.current.castShadow = params.castShadow!;
      if (params.distance !== undefined) session.current.distance = params.distance;
      if (params.angle !== undefined) session.current.angle = params.angle;
      if (params.penumbra !== undefined) session.current.penumbra = params.penumbra;
      if (params.position)
        session.current.position.set(...(params.position as [number, number, number]));
      if (params.target)
        session.current.target.position.set(...(params.target as [number, number, number]));
    }
  }
  if (lesson.kind === 'exposure') world.exposure = state.exposure;
  if (lesson.kind === 'lod-diagnostic') {
    world.pixelError = state.pixelError;
    // 'lod' is not an engine diagnostic mode: `clusters` is the closest available view, and its
    // legend (below) is written to match what it actually shows, not a level-of-detail split.
    world.diagnostic.mode = state.showLevels === 1 ? 'clusters' : 'beauty';
  }
  if (lesson.kind === 'memory') world.budget.geometryPool = state.geometryMiB * 1024 * 1024;
}
