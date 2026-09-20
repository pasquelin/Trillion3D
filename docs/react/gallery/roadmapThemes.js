export const themes = [
  ['transforms', 'Transforms', 'Transformations'],
  ['geometry', 'Geometry and bounds', 'Géométrie et volumes'],
  ['animation', 'Animation', 'Animation'],
  ['camera', 'Camera', 'Caméra'],
  ['materials', 'Materials and textures', 'Matériaux et textures'],
  ['lighting', 'Lights and shadows', 'Lumières et ombres'],
  ['postprocessing', 'Post-processing', 'Post-traitement'],
  ['particles', 'Particles and simulation', 'Particules et simulation'],
  ['interaction', 'Interaction', 'Interaction'],
  ['xr-audio', 'XR and audio', 'XR et audio'],
  ['performance', 'Performance and streaming', 'Performance et streaming'],
  ['integration', 'Formats and integration', 'Formats et intégration'],
  ['tests', 'Rendering tests', 'Tests de rendu'],
];

const groups = {
  animation: ['animation', 'skinning', 'morphtargets'],
  camera: ['camera', 'orthographic', 'panorama', 'multiple'],
  materials: [
    'material',
    'materials',
    'materialx',
    'texture',
    'textures',
    'texture2darray',
    'texture3d',
    'texturegather',
    'texturegrad',
    'cubemap',
    'clearcoat',
    'uv',
    'refraction',
    'reflection',
    'tonemapping',
    'hdr',
    'equirectangular',
  ],
  lighting: [
    'lights',
    'lightprobe',
    'lightprobes',
    'shadow',
    'shadowmap',
    'shadowmesh',
    'caustics',
    'fog',
    'lensflares',
    'sky',
    'backdrop',
  ],
  postprocessing: ['postprocessing', 'effects', 'deferred', 'mrt', 'oit', 'upscaling'],
  particles: ['physics', 'particles', 'gpgpu', 'compute', 'molecules', 'ocean', 'water'],
  interaction: [
    'controls',
    'interactive',
    'raycaster',
    'boxselection',
    'sculpt',
    'modifier',
    'games',
  ],
  'xr-audio': ['xr', 'vr', 'ar', 'audio', 'webaudio'],
  performance: ['performance', 'lod', 'batch', 'instance', 'instancing', 'occlusion'],
  integration: [
    'loader',
    'exporter',
    'worker',
    'compile',
    'video',
    'youtube',
    'css2d',
    'css3d',
    'svg',
    'label',
    'portal',
    'renderer',
    'display',
    'sandbox',
  ],
  tests: ['test', 'furnace', 'read'],
};

export function themeOf(entry) {
  const ready = {
    transforms: 'transforms',
    vectors: 'geometry',
    bounds: 'geometry',
    camera: 'camera',
    scene: 'transforms',
    color: 'materials',
    streaming: 'performance',
  }[entry.category];
  if (ready) return ready;
  return (
    Object.entries(groups).find(([, subjects]) => subjects.includes(entry.subject))?.[0] ??
    'geometry'
  );
}

export function themeLabel(id, locale) {
  const theme = themes.find(([value]) => value === id);
  return theme?.[locale === 'fr' ? 2 : 1] ?? id;
}
