const text = (en, fr) => ({ en, fr });
const range = (id, en, fr, min, max, value, step) => ({
  id,
  label: text(en, fr),
  min,
  max,
  value,
  step,
});

/**
 * The two-phase occlusion lesson: the garden's nine rings stand in three rows, so an eye at ring
 * height looking along a row sees the front ring hide the two behind it. The lesson moves that
 * eye — its height, its angle around the garden — and the engine's own counters say how many
 * clusters the previous image's pyramid withdrew and this image's pyramid rejected.
 */
export const occlusionLessonDefinition = {
  id: 'occlusion-two-phase',
  category: 'streaming',
  functions: ['homePose', 'setPose', 'createExplorer'],
  title: text('Hide a ring behind a ring', 'Cacher un anneau derrière un anneau'),
  description: text(
    'Lower the eye to ring height and look along a row: the clusters the front ring hides leave the image through the two-phase Hi-Z test.',
    'Abaissez l’œil à hauteur d’anneau et regardez le long d’une rangée : les grappes que l’anneau de devant cache quittent l’image par le test Hi-Z en deux passes.',
  ),
  controls: [
    range('height', 'Eye height', 'Hauteur de l’œil', 0.6, 7, 1.45, 0.05),
    range('angle', 'Orbit angle', 'Angle orbital', -180, 180, 0, 1),
  ],
  try: text(
    'Keep the height at 1.45 and compare 0°, 45° and 90°; then raise the eye above the rings.',
    'Gardez la hauteur à 1,45 et comparez 0°, 45° et 90° ; puis montez l’œil au-dessus des anneaux.',
  ),
  changes: text(
    'Occluded clusters rise when rings line up behind one another — most of all edge-on at 90° — and fall to zero from above.',
    'Les grappes occultées augmentent quand les anneaux s’alignent — surtout de profil à 90° — et retombent à zéro vu d’en haut.',
  ),
  mode: 'orbit',
  runtime: 'camera-pose',
  renderer: true,
  referenceCoverage: { webgpu_occlusion: 'full' },
  referenceReview: {
    urls: ['https://threejs.org/examples/webgpu_occlusion.html'],
    observed:
      'The reference asks its renderer whether one object is occluded, one query per object, and recolours it on the answer.',
    originalGoal:
      'The original garden shows the engine’s own two-phase test on its clusters: no query per object, one pyramid per image, counters reread from the device.',
  },
};
