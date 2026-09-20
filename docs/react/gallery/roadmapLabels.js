const frenchCategories = {
  transforms: 'Transformations',
  vectors: 'Vecteurs',
  camera: 'Caméra',
  bounds: 'Volumes',
  scene: 'Scène',
  color: 'Couleur',
  streaming: 'Streaming',
  webgl: 'Rendu WebGL',
  webgpu: 'Rendu WebGPU',
  webaudio: 'Audio web',
  webxr: 'Réalité étendue',
  games: 'Jeux',
  physics: 'Physique',
  misc: 'Divers',
  css2d: 'CSS 2D',
  css3d: 'CSS 3D',
  svg: 'SVG',
  tests: 'Tests',
  'webgl / postprocessing': 'WebGL / post-traitement',
  'webgl / advanced': 'WebGL / avancé',
  'webgl / tsl': 'WebGL / langage de shaders',
};
const frenchSubjects = {
  animation: 'animation',
  camera: 'caméra',
  loader: 'chargement',
  geometry: 'géométrie',
  material: 'matériau',
  materials: 'matériaux',
  shadow: 'ombres',
  light: 'lumière',
  controls: 'contrôles',
  texture: 'texture',
  physics: 'physique',
  audio: 'audio',
  postprocessing: 'post-traitement',
  performance: 'performance',
};

export const categoryLabel = (value, locale) =>
  locale === 'fr'
    ? (frenchCategories[value] ?? value)
    : value.replaceAll('webgl', 'WebGL').replaceAll('webgpu', 'WebGPU');
export const subjectLabel = (value, locale) =>
  locale === 'fr' ? (frenchSubjects[value] ?? value) : value.replaceAll('_', ' ');
