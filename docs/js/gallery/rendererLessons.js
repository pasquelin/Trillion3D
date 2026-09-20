import { lightingLessonDefinitions, LESSON_POINT_INTENSITY } from './lightingLessonDefinitions.js';
import { cameraLessonDefinitions } from './cameraLessonDefinitions.js';
import { offlineLessons } from './offline/lessons.js';
import { rendererSceneFor } from './rendererSceneAssignments.js';
const title = (en, fr) => ({ en, fr });
const control = (id, en, fr, min, max, value, step) => ({
  id,
  label: title(en, fr),
  type: min === 0 && max === 1 && step === 1 ? 'boolean' : 'range',
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
      'Pull the range inside the farthest buildings.',
      'Ramenez la portée devant les bâtiments les plus éloignés.',
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
      'Close the cone until it isolates one side of the sculpture.',
      'Fermez le cône jusqu’à isoler un côté de la sculpture.',
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
      'Rotate a directional light whose cascaded shadow pages follow the camera and are cached.',
      'Tournez une lumière directionnelle dont les pages d’ombre en cascades suivent la caméra et restent en cache.',
    ),
    controls: [
      control('intensity', 'Intensity', 'Intensité', 0.2, 6, 2.5, 0.1),
      control('angle', 'Sun angle', 'Angle du soleil', -180, 180, -35, 1),
    ],
    kind: 'directional',
    shadowStats: true,
    try: title(
      'Turn the sun, then zoom or orbit with the same sun, and read the shadow pages each move redraws.',
      'Tournez le soleil, puis zoomez ou orbitez à soleil fixe, et lisez les pages d’ombre que chaque geste redessine.',
    ),
    changes: title(
      'A new sun direction restarts every page of the four cascades; a camera move slides their windows by whole pages and redraws only the strips that enter; a still camera redraws nothing.',
      'Une nouvelle direction du soleil relance toutes les pages des quatre cascades ; un déplacement de caméra fait glisser leurs fenêtres par pages entières et ne redessine que les bandes qui entrent ; une caméra immobile ne redessine rien.',
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
    functions: ['setPixelError', 'setDiagnostic'],
    title: title(
      'Cross the observatory at any scale',
      'Traverser l’observatoire à toutes les échelles',
    ),
    description: title(
      'Move through a detailed architectural scene while its geometry adapts to the view.',
      'Parcourez une scène architecturale détaillée dont la géométrie s’adapte à la vue.',
    ),
    controls: [
      control('pixelError', 'Detail tolerance', 'Tolérance de détail', 0, 8, 1, 0.25),
      {
        ...control(
          'showLevels',
          'Show detail levels',
          'Afficher les niveaux de détail',
          0,
          1,
          0,
          1,
        ),
        legend: [
          { color: '#38bdf8', label: title('Exact detail', 'Détail exact') },
          { color: '#f59e0b', label: title('Coarse fallback', 'Relais simplifié') },
        ],
      },
    ],
    kind: 'lod-diagnostic',
    initialPose: { position: [19, 13, 22], target: [0, 3, 0] },
    referenceCoverage: { webgl_lod: 'full', webgl_batch_lod_bvh: 'partial' },
    referenceReview: {
      urls: [
        'https://threejs.org/examples/webgl_lod.html',
        'https://threejs.org/examples/webgl_batch_lod_bvh.html',
      ],
      observed:
        'A deep field makes distance and changing mesh density legible throughout the image; the batched variant adds many instances and spatial queries.',
      originalGoal:
        'A navigable original observatory keeps architecture readable in beauty mode, then exposes the continuously selected cluster cut on demand.',
    },
    try: title(
      'Orbit from the dome to the colonnade, then raise tolerance and reveal the selected levels.',
      'Tournez autour du dôme et de la colonnade, puis augmentez la tolérance et affichez les niveaux sélectionnés.',
    ),
    changes: title(
      'The triangle count falls as tolerance rises; level colours show where fine details give way.',
      'Le nombre de triangles baisse avec la tolérance ; les couleurs montrent où les détails fins cèdent.',
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
].map((lesson) =>
  lesson.kind === 'offline'
    ? { ...lesson, renderer: true }
    : rendererSceneFor({ ...lesson, renderer: true }),
);

export const rendererLessonById = (id) => rendererLessons.find((lesson) => lesson.id === id);
export const rendererInitialState = (lesson) =>
  Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));
