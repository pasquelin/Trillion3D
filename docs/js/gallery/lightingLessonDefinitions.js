const text = (en, fr) => ({ en, fr });
const range = (id, en, fr, min, max, value, step) => ({
  id,
  label: text(en, fr),
  min,
  max,
  value,
  step,
});

export const lightingLessonDefinitions = [
  {
    id: 'colored-light-balance',
    category: 'lighting',
    functions: ['addLight', 'setLight'],
    title: text('Balance two coloured lamps', 'Équilibrer deux lampes colorées'),
    description: text(
      'Mix warm and cool radiance on the same surfaces.',
      'Mélangez des radiances chaude et froide sur les mêmes surfaces.',
    ),
    controls: [
      range('warm', 'Warm lamp', 'Lampe chaude', 0.1, 8, 3, 0.1),
      range('cool', 'Cool lamp', 'Lampe froide', 0.1, 8, 3, 0.1),
    ],
    try: text(
      'Turn one lamp down, then balance both.',
      'Baissez une lampe, puis équilibrez les deux.',
    ),
    changes: text(
      'Linear light colours add before tone mapping.',
      'Les couleurs linéaires s’additionnent avant le tone mapping.',
    ),
    kind: 'color-balance',
  },
  {
    id: 'moving-point-shadow',
    category: 'lighting',
    functions: ['addLight', 'setLight'],
    title: text('Move a shadow-casting lamp', 'Déplacer une lampe avec ombres'),
    description: text(
      'Move one point emitter across the original sculpture.',
      'Déplacez un émetteur ponctuel au-dessus de la sculpture originale.',
    ),
    controls: [range('x', 'Horizontal position', 'Position horizontale', -5, 5, 0, 0.1)],
    try: text(
      'Cross the centre and compare both shadow directions.',
      'Traversez le centre et comparez les deux directions d’ombre.',
    ),
    changes: text(
      'The light position invalidates only affected shadow pages.',
      'La position invalide uniquement les pages d’ombre concernées.',
    ),
    kind: 'moving-point',
  },
  {
    id: 'shadow-casting-switch',
    category: 'lighting',
    functions: ['addLight', 'setLight'],
    title: text('Keep light, remove its shadow', 'Garder la lumière, retirer son ombre'),
    description: text(
      'Compare identical illumination with and without cast shadows.',
      'Comparez le même éclairage avec et sans ombres portées.',
    ),
    controls: [range('shadow', 'Cast shadow', 'Projeter une ombre', 0, 1, 1, 1)],
    try: text('Switch between zero and one.', 'Passez de zéro à un.'),
    changes: text(
      'Only shadow casting changes; direct radiance remains.',
      'Seule l’ombre change ; la radiance directe reste identique.',
    ),
    kind: 'shadow-switch',
  },
  {
    id: 'light-emitter-envelope',
    category: 'lighting',
    functions: ['addLight', 'setLight'],
    title: text('Protect a lamp from itself', 'Protéger une lampe contre elle-même'),
    description: text(
      'Set the physical envelope excluded from its own shadow map.',
      'Réglez l’enveloppe physique exclue de sa propre carte d’ombre.',
    ),
    controls: [range('radius', 'Emitter radius', 'Rayon émetteur', 0.05, 2, 0.2, 0.05)],
    try: text(
      'Grow the envelope around the visible lamp housing.',
      'Agrandissez l’enveloppe autour du boîtier visible.',
    ),
    changes: text(
      'The point-light shadow near plane follows this radius.',
      'Le plan proche de l’ombre ponctuelle suit ce rayon.',
    ),
    kind: 'emitter-radius',
  },
  {
    id: 'light-session-lifecycle',
    category: 'lighting',
    functions: ['addLight', 'removeLight'],
    title: text('Add and remove a live light', 'Ajouter et retirer une lumière'),
    description: text(
      'Exercise the light store lifecycle without rebuilding the scene.',
      'Exercez le cycle de vie des lumières sans reconstruire la scène.',
    ),
    controls: [range('enabled', 'Light enabled', 'Lumière active', 0, 1, 1, 1)],
    try: text(
      'Remove the only light and restore it.',
      'Retirez la seule lumière puis restaurez-la.',
    ),
    changes: text(
      'The lit view becomes black when the store has no light.',
      'La vue éclairée devient noire quand le magasin ne contient plus de lumière.',
    ),
    kind: 'light-lifecycle',
  },
].map((lesson) => ({ ...lesson, renderer: true, runtime: 'advanced-lighting' }));
