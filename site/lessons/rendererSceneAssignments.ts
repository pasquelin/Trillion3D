import type { RendererLessonItem } from './rendererLessonTypes.ts';

/** Scenes compiled outside `assets/gallery/offline/`; every other id is an offline lesson scene. */
const SCENE_FOLDERS: Record<string, string> = {
  'kinetic-garden': './assets/kinetic-garden',
  'shadow-theatre': './assets/gallery/shadow-theatre',
  'signature-architecture': './assets/gallery/signature-architecture',
};

const manifestOf = (scene: string) =>
  `${SCENE_FOLDERS[scene] ?? `./assets/gallery/offline/${scene}`}/cache/native/full/manifest.json`;

const assignments: Record<string, string> = {
  'point-light-range': 'city',
  'spot-light-cone': 'sculpture',
  'directional-shadow': 'hard-edges',
  'camera-exposure': 'vessel',
  'runtime-pixel-error': 'signature-architecture',
  'runtime-memory-budget': 'refinement',
  'colored-light-balance': 'painted',
  'moving-point-shadow': 'height-palette',
  'shadow-casting-switch': 'shadow-theatre',
  'light-emitter-envelope': 'implicit-shell',
  'light-session-lifecycle': 'contour',
  'many-lights-sampling': 'terrain',
  'camera-dolly': 'loft',
  'camera-orbit-pose': 'rational-roof',
  'camera-live-fov': 'ribbon',
  'camera-near-plane': 'bent-prism',
  'occlusion-two-phase': 'kinetic-garden',
};

export const rendererSceneFor = (lesson: RendererLessonItem) => ({
  ...lesson,
  manifest: manifestOf(assignments[lesson.id]),
  preview: `./assets/gallery/renderer/${lesson.id}.png`,
  importedLights: lesson.id === 'runtime-pixel-error',
  sceneLight: ['lod', 'memory'].includes(lesson.kind ?? '') || lesson.runtime === 'camera-pose',
  sceneFill:
    lesson.id !== 'runtime-pixel-error' &&
    !['light-lifecycle', 'shadow-switch', 'many-lights'].includes(lesson.kind ?? ''),
});
