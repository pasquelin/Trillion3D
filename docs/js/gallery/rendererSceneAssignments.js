const asset = (id) => `./assets/gallery/offline/${id}/cache/native/full/manifest.json`;

const assignments = {
  'point-light-range': 'city',
  'spot-light-cone': 'sculpture',
  'directional-shadow': 'hard-edges',
  'camera-exposure': 'vessel',
  'runtime-pixel-error': 'terrain',
  'runtime-memory-budget': 'refinement',
  'colored-light-balance': 'painted',
  'moving-point-shadow': 'height-palette',
  'shadow-casting-switch': 'shadow-theatre',
  'light-emitter-envelope': 'implicit-shell',
  'light-session-lifecycle': 'contour',
  'camera-dolly': 'loft',
  'camera-orbit-pose': 'rational-roof',
  'camera-live-fov': 'ribbon',
  'camera-near-plane': 'bent-prism',
};

export const rendererSceneFor = (lesson) => ({
  ...lesson,
  manifest:
    assignments[lesson.id] === 'kinetic-garden'
      ? './assets/kinetic-garden/cache/native/full/manifest.json'
      : assignments[lesson.id] === 'shadow-theatre'
        ? './assets/gallery/shadow-theatre/cache/native/full/manifest.json'
        : asset(assignments[lesson.id]),
  preview: `./assets/gallery/renderer/${lesson.id}.png`,
  importedLights: false,
  sceneLight: ['lod', 'memory'].includes(lesson.kind) || lesson.runtime === 'camera-pose',
  sceneFill: !['light-lifecycle', 'shadow-switch'].includes(lesson.kind),
});
