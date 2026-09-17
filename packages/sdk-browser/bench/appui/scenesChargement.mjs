// Fixtures du lot F : un manifeste de clusters et la scène Three.js qui va avec, tirés d'un
// générateur à graine fixe. Le chargement les lit une fois, donc la fixture doit être grande : des
// centaines de primitives, des milliers de pages, et la couverture exacte que le collecteur vérifie.
import * as THREE from 'three';
import { graine } from '../../../sdk-core/bench/socle.mjs';

const materiau = (index) =>
  new THREE.MeshStandardMaterial({ color: 0x808080 + index * 7, roughness: 0.5 });

/** Une page : bornes, erreur de cluster, sphère, et le triplet d'index qu'elle couvre. */
function pageDe(alea, id, url, triangles, role, depart) {
  const cx = (alea() - 0.5) * 20,
    cy = (alea() - 0.5) * 12,
    cz = (alea() - 0.5) * 8;
  const rayon = 0.5 + alea();
  return {
    id,
    url,
    bytes: triangles * 12,
    count: triangles * 3,
    min: [cx - rayon, cy - rayon, cz - rayon],
    max: [cx + rayon, cy + rayon, cz + rayon],
    role,
    level: role === 'coarse' ? 1 : 0,
    lodError: alea() * 2,
    sphere: [cx, cy, cz, rayon * 1.8],
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
    depthLayer: id % 3 === 0 ? 1 : 0,
    start: depart,
  };
}

/**
 * Un manifeste et sa scène. `primitives` maillages, `pages` pages exactes chacun, plus une page
 * grossière sur quatre primitives ; une primitive sur cinq porte une hiérarchie de culling, ce qui
 * exerce les deux branches de l'union de boîtes.
 */
export function manifesteEtScene({
  primitives = 200,
  pages = 12,
  triangles = 8,
  seed = 4201,
} = {}) {
  const alea = graine(seed);
  const source = new THREE.Group();
  const associations = new Map();
  const indices = new Map();
  const liste = [];
  let idPage = 0;
  for (let p = 0; p < primitives; p++) {
    const pagesPrimitive = [];
    const morceaux = [];
    let sommet = 0;
    for (let k = 0; k < pages; k++) {
      const url = `page/${p}/${k}`;
      const page = pageDe(alea, idPage++, url, triangles, 'exact', k * triangles * 3);
      const bloc = new Uint32Array(triangles * 3);
      for (let i = 0; i < bloc.length; i++) bloc[i] = sommet++;
      indices.set(url, bloc);
      morceaux.push(bloc);
      pagesPrimitive.push(page);
    }
    if (p % 4 === 0) {
      const url = `coarse/${p}`;
      const page = pageDe(alea, idPage++, url, triangles, 'coarse', undefined);
      indices.set(url, new Uint32Array(triangles * 3));
      pagesPrimitive.push(page);
    }
    const total = morceaux.reduce((n, bloc) => n + bloc.length, 0);
    const sourceIndex = new Uint32Array(total);
    let at = 0;
    for (const bloc of morceaux) {
      sourceIndex.set(bloc, at);
      at += bloc.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(sourceIndex, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sommet * 3), 3));
    const mesh = new THREE.Mesh(geometry, materiau(p));
    mesh.position.set(p % 10, Math.floor(p / 10), 0);
    source.add(mesh);
    associations.set(mesh, { meshes: p, primitives: 0 });
    const primitive = { mesh: p, primitive: 0, pass: 'opaque', pages: pagesPrimitive };
    if (p % 5 === 0) {
      const noeud = [-20, -12, -8, 20, 12, 8, 0, 0, 0, 30, -1, 0, 0, 0, pagesPrimitive.length];
      primitive.culling = { stride: 15, count: 1, nodes: noeud };
    }
    liste.push(primitive);
  }
  source.updateMatrixWorld(true);
  return { source, associations, metadata: { primitives: liste }, indices };
}

/** Les pages d'un manifeste vues comme le catalogue d'un moteur : octets, matériaux, attributs. */
export function catalogueDePages({ pages = 20000, materiaux = 60, seed = 5309 } = {}) {
  const alea = graine(seed);
  const liste = [];
  const attributs = [];
  for (let i = 0; i < materiaux; i++) {
    const positions = new Float32Array(3 * 3 * 64);
    for (let k = 0; k < positions.length; k++) positions[k] = alea() * 4 - 2;
    attributs.push({ position: new THREE.BufferAttribute(positions, 3) });
  }
  for (let i = 0; i < pages; i++) {
    const array = i % 9 ? new Uint32Array(3 * (1 + (i % 12))) : undefined;
    if (array) for (let k = 0; k < array.length; k++) array[k] = k % 192;
    liste.push({
      id: i,
      url: `p/${i % (pages - 7)}`,
      array,
      attributes: attributs[i % materiaux],
      material: materiau(i % materiaux),
      triangles: 1,
      cone: undefined,
    });
  }
  return liste;
}
