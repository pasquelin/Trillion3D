import { lightingLessonDefinitions, LESSON_POINT_INTENSITY } from './lightingLessonDefinitions.js';
import { cameraLessonDefinitions } from './cameraLessonDefinitions.js';
import { offlineLessons } from './offline/lessons.js';
const title = (en, fr) => ({ en, fr });
const control = (id, en, fr, min, max, value, step) => ({
  id,
  label: title(en, fr),
  min,
  max,
  value,
  step,
});

export const rendererLessons = [
  {
    id: 'point-light-range',
    category: 'lighting',
    functions: ['addLight', 'setLight', 'removeLight'],
    title: title('A lamp with a boundary', 'Une lampe avec une limite'),
    description: title(
      'Move the exact range where a point light stops contributing.',
      'Déplacez la limite exacte où une lumière ponctuelle cesse d’éclairer.',
    ),
    controls: [
      control('intensity', 'Intensity', 'Intensité', 5, 160, LESSON_POINT_INTENSITY, 5),
      control('range', 'Range', 'Portée', 1, 12, 6, 0.1),
    ],
    kind: 'point',
    try: title(
      'Pull the range inside the rear rings.',
      'Ramenez la portée devant les anneaux arrière.',
    ),
    changes: title(
      'Pixels beyond the range receive no energy.',
      'Les pixels au-delà de la portée ne reçoivent aucune énergie.',
    ),
  },
  {
    id: 'spot-light-cone',
    category: 'lighting',
    functions: ['addLight', 'setLight'],
    title: title('Shape a spotlight', 'Façonner un projecteur'),
    description: title(
      'Open a real spotlight cone while its axis stays on the sculpture.',
      'Ouvrez le cône réel d’un projecteur dirigé vers la sculpture.',
    ),
    controls: [
      control('intensity', 'Intensity', 'Intensité', 5, 200, 100, 5),
      control('cone', 'Half-angle', 'Demi-angle', 8, 55, 28, 1),
    ],
    kind: 'spot',
    try: title(
      'Close the cone until it isolates one ring.',
      'Fermez le cône jusqu’à isoler un anneau.',
    ),
    changes: title(
      'The public half-angle moves its soft boundary.',
      'Le demi-angle public déplace la bordure douce du cône.',
    ),
  },
  {
    id: 'directional-shadow',
    category: 'lighting',
    functions: ['addLight', 'setLight', 'lightingCapabilities'],
    title: title('Turn the shadow sun', 'Tourner le soleil des ombres'),
    description: title(
      'Rotate a directional light whose cascaded shadows follow the camera.',
      'Tournez une lumière directionnelle dont les ombres en cascades suivent la caméra.',
    ),
    controls: [
      control('intensity', 'Intensity', 'Intensité', 0.2, 6, 2.5, 0.1),
      control('angle', 'Sun angle', 'Angle du soleil', -180, 180, -35, 1),
    ],
    kind: 'directional',
    try: title('Sweep the sun across the floor.', 'Balayez le sol avec le soleil.'),
    changes: title(
      'Light direction and cascaded shadows rotate together.',
      'La lumière et les ombres en cascades tournent ensemble.',
    ),
  },
  {
    id: 'camera-exposure',
    category: 'lighting',
    functions: ['setEnvironment', 'addLight'],
    title: title('Expose the same radiance', 'Exposer la même radiance'),
    description: title(
      'Change exposure before ACES without changing the light energy.',
      'Changez l’exposition avant ACES sans modifier l’énergie lumineuse.',
    ),
    controls: [control('exposure', 'Exposure', 'Exposition', 0.2, 4, 1, 0.05)],
    kind: 'exposure',
    try: title('Compare 0.5 and 2 at fixed intensity.', 'Comparez 0,5 et 2 à intensité fixe.'),
    changes: title(
      'Tone mapping changes; incident radiance does not.',
      'Le tone mapping change ; la radiance incidente reste fixe.',
    ),
  },
  {
    id: 'runtime-pixel-error',
    category: 'streaming',
    functions: ['setPixelError'],
    title: title('Set the live LOD threshold', 'Régler le seuil LOD en direct'),
    description: title(
      'Change the projected-error threshold while the same streamed scene stays framed.',
      'Changez le seuil d’erreur projetée en gardant la même scène streamée cadrée.',
    ),
    controls: [control('pixelError', 'Pixel error', 'Erreur en pixels', 0, 8, 0, 0.25)],
    kind: 'lod',
    try: title(
      'Raise the threshold while watching triangle count.',
      'Montez le seuil en observant le nombre de triangles.',
    ),
    changes: title(
      'The selected DAG cut may become coarser.',
      'La coupe sélectionnée dans le DAG peut devenir plus grossière.',
    ),
  },
  {
    id: 'runtime-memory-budget',
    category: 'streaming',
    functions: ['setMemoryBudgets'],
    title: title('Resize a geometry pool', 'Redimensionner le pool géométrique'),
    description: title(
      'Apply a bounded runtime geometry budget and read back what the engine accepted.',
      'Appliquez un budget géométrique borné et lisez la valeur acceptée par le moteur.',
    ),
    controls: [control('geometryMiB', 'Geometry pool', 'Pool géométrique', 4, 64, 16, 4)],
    kind: 'memory',
    try: title('Shrink the pool, then restore 16 MiB.', 'Réduisez le pool, puis restaurez 16 Mio.'),
    changes: title(
      'The engine reports the accepted allocation.',
      'Le moteur publie l’allocation acceptée après bornage.',
    ),
  },
  ...lightingLessonDefinitions,
  ...cameraLessonDefinitions,
  ...offlineLessons,
].map((lesson) => ({ ...lesson, renderer: true }));

export const rendererLessonById = (id) => rendererLessons.find((lesson) => lesson.id === id);
export const rendererInitialState = (lesson) =>
  Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));
