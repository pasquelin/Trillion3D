const text = (en, fr) => ({ en, fr });
const range = (id, en, fr, min, max, value, step) => ({
  id,
  label: text(en, fr),
  min,
  max,
  value,
  step,
});

export const cameraLessonDefinitions = [
  {
    id: 'camera-dolly',
    title: text('Dolly through a streamed scene', 'Travelling dans une scène streamée'),
    description: text(
      'Move the eye toward its target without changing the lens.',
      'Rapprochez l’œil de sa cible sans changer l’objectif.',
    ),
    controls: [range('distance', 'Distance', 'Distance', 0.35, 1.8, 1, 0.05)],
    try: text(
      'Move close, then compare the selected triangle count.',
      'Approchez-vous, puis comparez le nombre de triangles sélectionnés.',
    ),
    changes: text(
      'The pose changes projected error and therefore the streamed cut.',
      'La pose change l’erreur projetée et donc la coupe streamée.',
    ),
    mode: 'dolly',
  },
  {
    id: 'camera-orbit-pose',
    title: text('Orbit with an explicit pose', 'Orbiter avec une pose explicite'),
    description: text(
      'Rotate the eye around the same documented target.',
      'Tournez l’œil autour de la même cible documentée.',
    ),
    controls: [range('angle', 'Orbit angle', 'Angle orbital', -180, 180, 0, 1)],
    try: text(
      'Compare front, side and rear views.',
      'Comparez les vues avant, latérale et arrière.',
    ),
    changes: text(
      'Only position changes; target and optics remain stable.',
      'Seule la position change ; cible et optique restent stables.',
    ),
    mode: 'orbit',
  },
  {
    id: 'camera-live-fov',
    title: text('Change the lens, keep the pose', 'Changer l’objectif, garder la pose'),
    description: text(
      'Vary vertical field of view at a fixed eye position.',
      'Faites varier le champ vertical depuis une position fixe.',
    ),
    controls: [range('fov', 'Vertical field of view', 'Champ vertical', 20, 100, 50, 1)],
    try: text(
      'Compare 25° and 90° without moving the eye.',
      'Comparez 25° et 90° sans déplacer l’œil.',
    ),
    changes: text(
      'Perspective and projected error change together.',
      'La perspective et l’erreur projetée changent ensemble.',
    ),
    mode: 'fov',
  },
  {
    id: 'camera-near-plane',
    title: text('Advance the near plane', 'Avancer le plan proche'),
    description: text(
      'Clip geometry near the eye with the public camera pose.',
      'Coupez la géométrie proche de l’œil avec la pose publique.',
    ),
    controls: [range('near', 'Near distance', 'Distance proche', 0.01, 4, 0.1, 0.01)],
    try: text(
      'Raise near until foreground geometry disappears.',
      'Montez le plan proche jusqu’à faire disparaître le premier plan.',
    ),
    changes: text(
      'Depth precision and visible camera volume change.',
      'La précision de profondeur et le volume visible changent.',
    ),
    mode: 'near',
  },
].map((lesson) => ({
  ...lesson,
  category: 'camera',
  functions: ['homePose', 'setPose'],
  renderer: true,
  runtime: 'camera-pose',
}));
