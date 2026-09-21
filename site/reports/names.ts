const VIEWS = {
  generale: ['Overview', 'Vue générale'],
  sol: ['Street level', 'Au sol'],
  rue: ['Street corner', 'Angle de rue'],
  detail: ['Close-up', 'Gros plan'],
};
const RUNS = {
  'raster-1248': [
    'Two ways to draw the same image · 1248 × 702',
    'Deux façons de dessiner la même image · 1248 × 702',
  ],
  'raster-2496': [
    'Two ways to draw the same image · 2496 × 1404',
    'Deux façons de dessiner la même image · 2496 × 1404',
  ],
  mobile: ['Moving camera · sun and shadows', 'Caméra mobile · soleil et ombres'],
  fixe: ['Still camera · held image', 'Caméra fixe · image conservée'],
  'sans-lumiere': ['Unlit image', 'Image sans éclairage'],
  'soleil-sans-ombres': ['Sun without shadows', 'Soleil sans ombres'],
  'aa-off': ['Without temporal antialiasing', 'Sans anticrénelage temporel'],
  'profil-off': ['Without profiling', 'Sans profilage'],
  'textures-host': ['Source textures', 'Textures sources'],
  isolation: ['Cross-origin isolation', 'Isolation entre origines'],
  'math-js': ['JavaScript calculations', 'Calculs JavaScript'],
  'math-wasm': ['WebAssembly calculations', 'Calculs WebAssembly'],
  rebond: ['Indirect lighting enabled', 'Éclairage indirect activé'],
  'three-nu': ['Vanilla Three.js / Web Geometry', 'Three.js standard / Web Geometry'],
  'three-lod': ['Three.js LOD / Web Geometry', 'Three.js LOD / Web Geometry'],
  'temoin-three': ['Untextured SDK witness', 'Témoin SDK sans textures'],
  'ombres-pages-off': ['Shadow paging disabled', 'Ombres sans découpage en pages'],
  'budget-ombres-0-25': ['Shadow time budget: 0.25 ms', 'Temps réservé aux ombres : 0,25 ms'],
  'budget-3000': ['Geometry budget: 3000 pages', 'Budget de géométrie : 3 000 pages'],
  webgl: ['WebGL renderer', 'Rendu WebGL'],
  webgl2: ['WebGL 2 renderer', 'Rendu WebGL 2'],
  'lampe-mobile': ['Moving light', 'Lumière mobile'],
  visible: ['Visible browser window', 'Fenêtre du navigateur visible'],
};
export const viewName = (id, locale) => VIEWS[id]?.[locale === 'fr' ? 1 : 0] ?? id;
export function runName(id, locale) {
  const fr = locale === 'fr';
  if (RUNS[id]) return RUNS[id][fr ? 1 : 0];
  const size = id?.match(/^(?:res|three-(?:nu|lod))-(\d+)(?:-e(\d+))?$/);
  if (size)
    return `${id.startsWith('three-lod') ? 'Three.js LOD / Web Geometry · ' : id.startsWith('three-nu') ? 'Three.js / Web Geometry · ' : ''}${fr ? 'Image de' : 'Image width'} ${size[1]} px${size[2] ? ` · ${fr ? 'seuil' : 'threshold'} ${size[2]} px` : ''}`;
  const lights = id?.match(/^(?:(three-nu|three-lod)-)?lampes-(\d+)(-sans-ombres)?$/);
  if (lights)
    return `${lights[1] ? `${engineName(lights[1])} / Web Geometry · ` : ''}${lights[2]} ${fr ? 'lumières' : 'lights'}${lights[3] ? (fr ? ' sans ombres' : ' without shadows') : ''}`;
  const instances = id?.match(/^instances-(\d+)$/);
  if (instances) return `${instances[1]} ${fr ? 'copies de la scène' : 'scene copies'}`;
  const shadows = id?.match(/^(three-nu|three-lod)-sans-ombres$/);
  if (shadows)
    return `${engineName(shadows[1])} / Web Geometry · ${fr ? 'sans ombres' : 'without shadows'}`;
  return id;
}
export const engineName = (id) =>
  ({
    'webgpu-page-raster': 'Web Geometry · WebGPU',
    'exact-cluster-pages': 'SDK · reference',
    'three-nu': 'Three.js',
    'three-lod': 'Three.js LOD',
  })[id] ??
  id ??
  '—';
