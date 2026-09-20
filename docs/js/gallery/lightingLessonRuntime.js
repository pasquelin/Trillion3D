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

export function applyLightingLesson(explorer, lesson, state, session) {
  if (lesson.kind === 'color-balance') {
    upsert(explorer, session, point('warm', [-3, 3, 2], [1, 0.35, 0.12], state.warm));
    upsert(explorer, session, point('cool', [3, 3, 2], [0.12, 0.4, 1], state.cool));
  }
  if (lesson.kind === 'moving-point')
    upsert(explorer, session, point('moving', [state.x, 4, 2], [1, 0.8, 0.55], 3));
  if (lesson.kind === 'shadow-switch')
    upsert(
      explorer,
      session,
      point('switch', [0, 4, 2], [1, 0.8, 0.55], 3, { castsShadow: state.shadow === 1 }),
    );
  if (lesson.kind === 'emitter-radius')
    upsert(
      explorer,
      session,
      point('envelope', [0, 4, 2], [1, 0.8, 0.55], 3, { emitterRadius: state.radius }),
    );
  if (lesson.kind === 'light-lifecycle') {
    if (state.enabled === 1)
      upsert(explorer, session, point('lifecycle', [0, 4, 2], [1, 0.8, 0.55], 3));
    else if (session.ids.delete('lifecycle')) explorer.removeLight('lifecycle');
    explorer.setLightingView('lit');
  }
}

export const createLightingLessonSession = () => ({ ids: new Set() });
