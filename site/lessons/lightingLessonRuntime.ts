import type {
  light as lightFamily,
  Light,
  LightParameters,
  World,
} from '../../packages/sdk-browser/index.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';
import {
  LESSON_POINT_INTENSITY,
  LESSON_RING_COLORS,
  LESSON_RING_HEIGHT,
  LESSON_RING_INTENSITY,
  LESSON_RING_RADIUS,
  LESSON_RING_RANGE,
} from './lightingLessonDefinitions.ts';

/** The live lights a lighting lesson has already added, by id: a later update patches the same
 *  object rather than adding a second one — the new surface keeps no id store of its own. */
export interface LightingLessonSession {
  lights: Map<string, Light>;
}

const point = (
  position: [number, number, number],
  color: [number, number, number],
  intensity: number,
  patch: Partial<LightParameters> = {},
): LightParameters => ({ position, color, intensity, distance: 10, castShadow: true, ...patch });

function upsert(
  light: typeof lightFamily,
  world: World,
  session: LightingLessonSession,
  id: string,
  params: LightParameters,
) {
  const existing = session.lights.get(id);
  if (existing) {
    existing.color.set(params.color!);
    existing.intensity = params.intensity!;
    existing.castShadow = params.castShadow!;
    if (params.radius !== undefined) existing.radius = params.radius;
    if (params.position) existing.position.set(...(params.position as [number, number, number]));
  } else {
    const made = light.point(params);
    world.scene.add(made);
    session.lights.set(id, made);
  }
}

function remove(world: World, session: LightingLessonSession, id: string) {
  const light = session.lights.get(id);
  if (light) {
    world.scene.remove(light);
    session.lights.delete(id);
  }
}

/** The ring lesson's lamps: `count` of them, evenly spaced above the terrain, colours in turn. */
export function ringLamps(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const raw = [
      Math.cos(angle) * LESSON_RING_RADIUS,
      LESSON_RING_HEIGHT,
      Math.sin(angle) * LESSON_RING_RADIUS,
    ].map((v) => +v.toFixed(2));
    const position: [number, number, number] = [raw[0], raw[1], raw[2]];
    return { id: `ring-${i}`, position, color: LESSON_RING_COLORS[i % 2] };
  });
}

export function applyLightingLesson(
  light: typeof lightFamily,
  world: World,
  lesson: RendererLessonItem,
  state: Record<string, number>,
  session: LightingLessonSession,
) {
  if (lesson.kind === 'color-balance') {
    upsert(light, world, session, 'warm', point([-3, 3, 2], [1, 0.35, 0.12], state.warm));
    upsert(light, world, session, 'cool', point([3, 3, 2], [0.12, 0.4, 1], state.cool));
  }
  if (lesson.kind === 'moving-point')
    upsert(
      light,
      world,
      session,
      'moving',
      point([state.x, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY),
    );
  if (lesson.kind === 'shadow-switch')
    upsert(
      light,
      world,
      session,
      'switch',
      point([-3, 7, 10], [1, 0.72, 0.42], 1800, {
        distance: 30,
        castShadow: state.shadow === 1,
      }),
    );
  if (lesson.kind === 'emitter-radius')
    upsert(
      light,
      world,
      session,
      'envelope',
      point([0, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY, { radius: state.radius }),
    );
  if (lesson.kind === 'many-lights') {
    for (const lamp of ringLamps(state.count))
      upsert(
        light,
        world,
        session,
        lamp.id,
        point(lamp.position, lamp.color, LESSON_RING_INTENSITY, { distance: LESSON_RING_RANGE }),
      );
    for (const id of [...session.lights.keys()])
      if (id.startsWith('ring-') && Number(id.slice(5)) >= state.count) remove(world, session, id);
  }
  if (lesson.kind === 'light-lifecycle') {
    if (state.enabled === 1)
      upsert(
        light,
        world,
        session,
        'lifecycle',
        point([0, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY),
      );
    else remove(world, session, 'lifecycle');
    world.diagnostic.mode = 'beauty';
  }
}

export const createLightingLessonSession = (): LightingLessonSession => ({ lights: new Map() });
