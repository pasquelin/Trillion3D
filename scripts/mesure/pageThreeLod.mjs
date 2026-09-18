// Le témoin Three.js à NIVEAUX DE DÉTAIL : la méthode classique d'avant Nanite. Chaque maillage du
// glTF devient un `THREE.LOD` à trois niveaux — l'original, puis deux versions simplifiées à la
// volée par meshoptimizer (la dépendance de dev du banc, servie sous `/vendor/meshoptimizer/`) —
// et Three choisit le niveau à la distance, objet par objet. C'est ce qu'un projet Three soigné
// fait à la main ; c'est le repère entre le Three nu (tout, toujours) et le moteur (par grappe).
//
// Règle unique, aucune scène nommée : un niveau moins fin dès que l'objet fait moins de
// `PIXELS[i]` pixels de haut à l'écran — la distance se déduit du rayon de l'objet, de la hauteur
// de l'image et du champ de la pose. Un niveau qui ne retire pas au moins un quart des triangles
// du précédent est abandonné : la simplification n'a rien donné sur ce maillage, et le dire vaut
// mieux qu'un niveau de plus qui coûte autant. Coût déclaré : la silhouette simplifiée s'écarte de
// l'original (`ERREUR` relative à la taille du maillage), ce que la capture montre.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mesurerThree } from './pageThreeMesure.mjs';

/** Chaque niveau au-delà de l'original : part des triangles visée, erreur tolérée (relative à la
 *  taille du maillage), et hauteur à l'écran en pixels sous laquelle il remplace le précédent. */
const NIVEAUX = [
  { part: 0.25, erreur: 0.02, pixels: 200 },
  { part: 0.06, erreur: 0.08, pixels: 50 },
];
const GAIN_MINIMUM = 0.75;

/** La géométrie simplifiée à `part` de ses triangles, ou `null` si le gain est trop faible. */
function simplifier(geometrie, part, erreur) {
  const positions = geometrie.attributes.position.array;
  const indices = geometrie.index.array;
  const cible = Math.max(3, Math.floor((indices.length * part) / 3) * 3);
  // meshoptimizer rend l'index dans le type reçu : un maillage en 16 bits le reste à chaque niveau.
  const [nouveaux] = MeshoptSimplifier.simplify(indices, positions, 3, cible, erreur);
  if (nouveaux.length > indices.length * GAIN_MINIMUM) return null;
  // Les sommets restent ceux de l'original, partagés : seul l'index change d'un niveau à l'autre.
  // Les bornes aussi : un sous-ensemble des mêmes sommets tient dans celles que le chargeur a
  // posées, et Three n'a pas à les recalculer sur trois millions de sommets par niveau.
  const g = new THREE.BufferGeometry();
  for (const [nom, attribut] of Object.entries(geometrie.attributes)) g.setAttribute(nom, attribut);
  g.setIndex(new THREE.BufferAttribute(nouveaux, 1));
  g.boundingBox = geometrie.boundingBox?.clone() ?? null;
  g.boundingSphere = geometrie.boundingSphere?.clone() ?? null;
  return g;
}

/** Les niveaux d'une géométrie : l'original, puis chaque niveau simplifié depuis le précédent. */
function construireNiveaux(geometrie) {
  const niveaux = [geometrie];
  for (const { part, erreur } of NIVEAUX) {
    const g = simplifier(niveaux.at(-1), part, erreur);
    if (!g) break;
    niveaux.push(g);
  }
  return niveaux;
}

/** La distance à laquelle un objet de rayon `rayon` fait `pixels` pixels de haut. */
const distancePour = (rayon, pixels, hauteur, fov) =>
  (rayon * hauteur) / (2 * pixels * Math.tan((fov * Math.PI) / 360));

/**
 * Remplace chaque maillage indexé de `racine` par un `THREE.LOD` à ses niveaux, même matériau,
 * même transformation. Rend ce que le relevé publie : niveaux construits et triangles par niveau.
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
    // Une géométrie partagée par des instances n'est simplifiée, et comptée, qu'une fois.
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
    // La sphère que le chargeur glTF a posée depuis les bornes de l'accesseur, sinon la calculer ;
    // l'échelle monde se lit sur la première colonne de la matrice, sans décomposer.
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

/** Une vue, un seuil (ignoré : Three n'a pas de seuil), la capture. Même contrat que `measureView`. */
export const measureView = (options) => mesurerThree(options, niveauxDeDetail);
