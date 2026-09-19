// The Three.js LEVEL-OF-DETAIL witness: the classic method from before clustered geometry.
// Each glTF mesh becomes a three-level `THREE.LOD` — the original, then two versions simplified
// on the fly by meshoptimizer (the bench's dev dependency, served under `/vendor/meshoptimizer/`)
// — and Three picks the level by distance, object by object. That is what a careful Three
// project does by hand; it is the marker between bare Three (everything, always) and the
// engine (by cluster).
//
// One rule, no named scene: a coarser level as soon as the object is less than `PIXELS[i]`
// pixels high on screen — distance is deduced from the object's radius, the image height and
// the pose field of view. A level that does not drop at least a quarter of the previous
// level's triangles is abandoned: simplification gave nothing on that mesh, and saying so
// is better than one more level that costs the same. Declared cost: the simplified silhouette
// diverges from the original (`ERREUR` relative to the mesh size), which the capture shows.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mesurerThree } from './pageThreeMesure.mjs';

/** Each level beyond the original: target triangle fraction, tolerated error (relative to
 *  mesh size), and on-screen height in pixels under which it replaces the previous one. */
const NIVEAUX = [
  { part: 0.25, erreur: 0.02, pixels: 200 },
  { part: 0.06, erreur: 0.08, pixels: 50 },
];
const GAIN_MINIMUM = 0.75;

/** Geometry simplified to `part` of its triangles, or `null` if the gain is too small. */
function simplifier(geometrie, part, erreur) {
  const positions = geometrie.attributes.position.array;
  const indices = geometrie.index.array;
  const cible = Math.max(3, Math.floor((indices.length * part) / 3) * 3);
  // meshoptimizer returns the index in the received type: a 16-bit mesh stays so at each level.
  const [nouveaux] = MeshoptSimplifier.simplify(indices, positions, 3, cible, erreur);
  if (nouveaux.length > indices.length * GAIN_MINIMUM) return null;
  // Vertices stay those of the original, shared: only the index changes from one level to
  // the next. Bounds too: a subset of the same vertices fits in those the loader placed,
  // and Three does not have to recompute them on three million vertices per level.
  const g = new THREE.BufferGeometry();
  for (const [nom, attribut] of Object.entries(geometrie.attributes)) g.setAttribute(nom, attribut);
  g.setIndex(new THREE.BufferAttribute(nouveaux, 1));
  g.boundingBox = geometrie.boundingBox?.clone() ?? null;
  g.boundingSphere = geometrie.boundingSphere?.clone() ?? null;
  return g;
}

/** Levels of a geometry: the original, then each level simplified from the previous. */
function construireNiveaux(geometrie) {
  const niveaux = [geometrie];
  for (const { part, erreur } of NIVEAUX) {
    const g = simplifier(niveaux.at(-1), part, erreur);
    if (!g) break;
    niveaux.push(g);
  }
  return niveaux;
}

/** Distance at which an object of radius `rayon` is `pixels` pixels high. */
const distancePour = (rayon, pixels, hauteur, fov) =>
  (rayon * hauteur) / (2 * pixels * Math.tan((fov * Math.PI) / 360));

/**
 * Replaces each indexed mesh of `racine` with a `THREE.LOD` at its levels, same material,
 * same transform. Returns what the reading publishes: levels built and triangles per level.
 */
export async function niveauxDeDetail(racine, options) {
  await MeshoptSimplifier.ready;
  const cache = new Map();
  const hauteur = options.height,
    fov = options.pose.fov;
  const triangles = new Array(NIVEAUX.length + 1).fill(0);
  let objets = 0,
    sansNiveau = 0;
  const maillages = [];
  racine.traverse((o) => {
    if (o.isMesh && o.geometry?.index) maillages.push(o);
  });
  racine.updateMatrixWorld(true);
  for (const mesh of maillages) {
    // A geometry shared by instances is simplified, and counted, only once.
    let niveaux = cache.get(mesh.geometry);
    if (!niveaux) {
      niveaux = construireNiveaux(mesh.geometry);
      cache.set(mesh.geometry, niveaux);
      niveaux.forEach((g, i) => (triangles[i] += g.index.count / 3));
    }
    if (niveaux.length === 1) {
      sansNiveau++;
      continue;
    }
    // The sphere the glTF loader placed from the accessor bounds, otherwise compute it;
    // world scale is read on the first matrix column, without decomposing.
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const e = mesh.matrixWorld.elements;
    const rayon = mesh.geometry.boundingSphere.radius * Math.hypot(e[0], e[1], e[2]);
    const lod = new THREE.LOD();
    lod.name = mesh.name;
    lod.position.copy(mesh.position);
    lod.quaternion.copy(mesh.quaternion);
    lod.scale.copy(mesh.scale);
    niveaux.forEach((g, i) => {
      const niveau = new THREE.Mesh(g, mesh.material);
      niveau.frustumCulled = mesh.frustumCulled;
      lod.addLevel(niveau, i === 0 ? 0 : distancePour(rayon, NIVEAUX[i - 1].pixels, hauteur, fov));
    });
    mesh.parent.add(lod);
    mesh.parent.remove(mesh);
    objets++;
  }
  return { lodObjets: objets, lodSansNiveau: sansNiveau, lodTrianglesParNiveau: triangles };
}

/** One view, one threshold (ignored: Three has no threshold), the capture. Same contract as `measureView`. */
export const measureView = (options) => mesurerThree(options, niveauxDeDetail);
