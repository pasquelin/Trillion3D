const light = (id, position, color, intensity, emitterRadius = 0.1, castsShadow = true) =>
  `explorer.addLight({ id: '${id}', kind: 'point', position: [${position}], color: [${color}], intensity: ${intensity}, range: 10, emitterRadius: ${emitterRadius}, castsShadow: ${castsShadow} });`;

function operation(lesson, state) {
  if (lesson.kind === 'color-balance')
    return `${light('warm', '-3, 3, 2', '1, 0.35, 0.12', state.warm)}
${light('cool', '3, 3, 2', '0.12, 0.4, 1', state.cool)}`;
  if (lesson.kind === 'moving-point') return light('moving', `${state.x}, 4, 2`, '1, 0.8, 0.55', 3);
  if (lesson.kind === 'shadow-switch')
    return light('switch', '0, 4, 2', '1, 0.8, 0.55', 3, 0.1, state.shadow === 1);
  if (lesson.kind === 'emitter-radius')
    return light('envelope', '0, 4, 2', '1, 0.8, 0.55', 3, state.radius);
  return `${light('lifecycle', '0, 4, 2', '1, 0.8, 0.55', 3)}
explorer.removeLight('lifecycle');`;
}

export function lightingLessonCode(lesson, state) {
  return `import { createExplorer, webgpuPagesBackend } from './engine.js';

const explorer = await createExplorer(canvas, {
  manifestUrl: './assets/kinetic-garden/cache/native/full/manifest.json',
  scope: 'full',
  backends: [webgpuPagesBackend],
  importedLights: false,
});
${operation(lesson, state)}
explorer.render();
// Call explorer.dispose() when the view is removed.`;
}
