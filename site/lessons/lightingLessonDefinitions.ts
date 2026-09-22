import type { RendererLessonItem } from './rendererLessonTypes.ts';
import { range, text } from './lessonDefinitionHelpers.ts';

export const LESSON_POINT_INTENSITY = 80;
const LESSON_COLORED_INTENSITY = 60;
/** Lamps of the ring lesson, above the watershed's peaks: two colours in turn, so a drawn
 *  subset differs from the whole; a range that reaches past the valley, so every lamp meets
 *  the others there while each still pools its colour on its own slope. */
export const LESSON_RING_INTENSITY = 45;
export const LESSON_RING_RANGE = 11;
export const LESSON_RING_RADIUS = 6;
export const LESSON_RING_HEIGHT = 4.5;
export const LESSON_RING_COLORS: [number, number, number][] = [
  [1, 0.3, 0.08],
  [0.08, 0.35, 1],
];

const lightingLessonBase: RendererLessonItem[] = [
  {
    id: 'colored-light-balance',
    category: 'lighting',
    functions: ['scene.add(light.*)', 'light.intensity ='],
    title: text('Balance two coloured lamps', 'Équilibrer deux lampes colorées'),
    description: text(
      'Mix warm and cool radiance on the same surfaces.',
      'Mélangez des radiances chaude et froide sur les mêmes surfaces.',
    ),
    controls: [
      range('warm', 'Warm lamp', 'Lampe chaude', 5, 160, LESSON_COLORED_INTENSITY, 5),
      range('cool', 'Cool lamp', 'Lampe froide', 5, 160, LESSON_COLORED_INTENSITY, 5),
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
    functions: ['scene.add(light.*)', 'light.intensity ='],
    title: text('Move a shadow-casting lamp', 'Déplacer une lampe avec ombres'),
    description: text(
      'Move one point emitter across a rolling terrain.',
      'Déplacez un émetteur ponctuel au-dessus d’un terrain ondulé.',
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
    functions: ['scene.add(light.*)', 'light.intensity ='],
    title: text('Keep light, remove its shadow', 'Garder la lumière, retirer son ombre'),
    description: text(
      'Compare identical illumination with and without cast shadows.',
      'Comparez le même éclairage avec et sans ombres portées.',
    ),
    controls: [range('shadow', 'Cast shadow', 'Projeter une ombre', 0, 1, 1, 1)],
    referenceReview: {
      urls: ['https://threejs.org/examples/webgl_shadowmap.html'],
      observed:
        'Large animated actors cross a bright stage and cast long moving shadows across the set.',
      originalGoal:
        'An original miniature theatre keeps its lamp and materials visible while suspended paper actors either cast silhouettes or let the projection wall remain clear.',
    },
    initialPose: { position: [0, 5.5, 14], target: [0, 4, -1] },
    try: text(
      'Keep the lamp on and compare the projection wall with and without the actors’ silhouettes.',
      'Gardez la lampe allumée et comparez la paroi avec et sans les silhouettes des acteurs.',
    ),
    changes: text(
      'Only the cast silhouettes disappear; direct illumination and the theatre remain visible.',
      'Seules les silhouettes projetées disparaissent ; l’éclairage direct et le théâtre restent visibles.',
    ),
    kind: 'shadow-switch',
  },
  {
    id: 'light-emitter-envelope',
    category: 'lighting',
    functions: ['scene.add(light.*)', 'light.intensity ='],
    title: text('Protect a lamp from itself', 'Protéger une lampe contre elle-même'),
    description: text(
      'Set the physical envelope excluded from its own shadow map.',
      'Réglez l’enveloppe physique exclue de sa propre carte d’ombre.',
    ),
    controls: [range('radius', 'Emitter radius', 'Rayon émetteur', 0.05, 2, 0.2, 0.05)],
    try: text(
      'Grow the envelope and compare the shell’s closest shadows.',
      'Agrandissez l’enveloppe et comparez les ombres proches de la coque.',
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
    functions: ['scene.add(light.*)', 'scene.remove'],
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
      'The fill light is disabled in this lesson, so removing the store light makes the view black.',
      'L’éclairage d’appoint est désactivé dans cette leçon : retirer la lumière rend la vue noire.',
    ),
    kind: 'light-lifecycle',
  },
  {
    id: 'many-lights-sampling',
    category: 'lighting',
    functions: ['scene.add(light.*)', 'light.intensity =', 'scene.remove'],
    title: text('Light a surface with many lamps', 'Éclairer une surface avec beaucoup de lampes'),
    description: text(
      'Ring a terrain with more lamps than a moving pixel shades, and watch the image converge.',
      'Entourez un terrain de plus de lampes qu’un pixel en mouvement n’en calcule, et regardez l’image converger.',
    ),
    controls: [range('count', 'Lamps', 'Lampes', 2, 16, 12, 1)],
    referenceCoverage: { webgpu_lights_pointlights: 'full' },
    referenceReview: {
      urls: ['https://threejs.org/examples/webgpu_lights_pointlights.html'],
      observed: 'Several coloured point lights circle above one model and tint it in turn.',
      originalGoal:
        'An original rolling terrain under a ring of warm and cool lamps, all overlapping: while the camera moves each pixel shades four drawn lamps and the history averages the draws; at rest every lamp is shaded and the image holds.',
    },
    initialPose: { position: [0, 9, 12], target: [0, 1.5, 0] },
    try: text(
      'Orbit with sixteen lamps, then stop: the frame counter reads Paused once the still image has converged.',
      'Tournez avec seize lampes, puis arrêtez-vous : le compteur affiche Pause une fois l’image immobile convergée.',
    ),
    changes: text(
      'A moving pixel shades at most lightSettings.samplesPerPixel lamps whatever their count; a still one shades them all.',
      'Un pixel en mouvement ne calcule au plus que lightSettings.samplesPerPixel lampes quel que soit leur nombre ; un pixel immobile les calcule toutes.',
    ),
    kind: 'many-lights',
  },
];

export const lightingLessonDefinitions: RendererLessonItem[] = lightingLessonBase.map((lesson) => ({
  ...lesson,
  renderer: true,
  runtime: 'advanced-lighting',
}));
