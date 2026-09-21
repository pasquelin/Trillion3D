const point = (id, position, color, intensity, patch = {}) => ({
  id,
  kind: 'point',
  position,
  color,
  intensity,
  range: 10,
  emitterRadius: 0.1,
  castsShadow: true,
  ...patch,
});

function upsert(explorer, session, light) {
  if (session.ids.has(light.id)) {
    const { id, ...patch } = light;
    explorer.setLight(id, patch);
  } else {
    explorer.addLight(light);
    session.ids.add(light.id);
  }
}

/** The ring lesson's lamps: `count` of them, evenly spaced above the terrain, colours in turn. */
export function ringLamps(count) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const position = [
      Math.cos(angle) * LESSON_RING_RADIUS,
      LESSON_RING_HEIGHT,
      Math.sin(angle) * LESSON_RING_RADIUS,
    ].map((v) => +v.toFixed(2));
    return { id: `ring-${i}`, position, color: LESSON_RING_COLORS[i % 2] };
  });
}

export function applyLightingLesson(explorer, lesson, state, session) {
  if (lesson.kind === 'color-balance') {
    upsert(explorer, session, point('warm', [-3, 3, 2], [1, 0.35, 0.12], state.warm));
    upsert(explorer, session, point('cool', [3, 3, 2], [0.12, 0.4, 1], state.cool));
  }
  if (lesson.kind === 'moving-point')
    upsert(
      explorer,
      session,
      point('moving', [state.x, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY),
    );
  if (lesson.kind === 'shadow-switch')
    upsert(
      explorer,
      session,
      point('switch', [-3, 7, 10], [1, 0.72, 0.42], 1800, {
        range: 30,
        castsShadow: state.shadow === 1,
      }),
    );
  if (lesson.kind === 'emitter-radius')
    upsert(
      explorer,
      session,
      point('envelope', [0, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY, {
        emitterRadius: state.radius,
      }),
    );
  if (lesson.kind === 'many-lights') {
    for (const lamp of ringLamps(state.count))
      upsert(
        explorer,
        session,
        point(lamp.id, lamp.position, lamp.color, LESSON_RING_INTENSITY, {
          range: LESSON_RING_RANGE,
        }),
      );
    for (const id of [...session.ids])
      if (id.startsWith('ring-') && Number(id.slice(5)) >= state.count) {
        session.ids.delete(id);
        explorer.removeLight(id);
      }
  }
  if (lesson.kind === 'light-lifecycle') {
    if (state.enabled === 1)
      upsert(
        explorer,
        session,
        point('lifecycle', [0, 4, 2], [1, 0.8, 0.55], LESSON_POINT_INTENSITY),
      );
    else if (session.ids.delete('lifecycle')) explorer.removeLight('lifecycle');
    explorer.setLightingView('lit');
  }
}

export const createLightingLessonSession = () => ({ ids: new Set() });
import {
  LESSON_POINT_INTENSITY,
  LESSON_RING_COLORS,
  LESSON_RING_HEIGHT,
  LESSON_RING_INTENSITY,
  LESSON_RING_RADIUS,
  LESSON_RING_RANGE,
} from './lightingLessonDefinitions.js';
