const VIEWS = {
  generale: ['Overview', 'Vue générale'],
  sol: ['Street level', 'Au sol'],
  rue: ['Street corner', 'Angle de rue'],
  detail: ['Close-up', 'Gros plan'],
};
const RUNS = {
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
  'lampe-mobile': ['Moving light', 'Lumière mobile'],
  visible: ['Visible browser window', 'Fenêtre du navigateur visible'],
};
export const viewName = (id, locale) => VIEWS[id]?.[locale === 'fr' ? 1 : 0] ?? id;
export const runName = (id, locale) => RUNS[id]?.[locale === 'fr' ? 1 : 0] ?? id;
export const engineName = (id) =>
  ({
    'webgpu-page-raster': 'Web Geometry · WebGPU',
    'three-nu': 'Three.js',
    'three-lod': 'Three.js LOD',
  })[id] ?? id;
