// Entrées du banc : réalistes (une coupe de milliers de pages devant une caméra) et hostiles
// (triangles dégénérés, sommets derrière la caméra, NaN, Infinity, -0, boîtes vides ou inversées).
// Tout vient d'un générateur à graine fixe : deux exécutions voient exactement les mêmes flottants.
import * as THREE from 'three';
import { graine } from '../../../sdk-core/bench/socle.mjs';

export function camera(z = 6, near = 0.1, aspect = 16 / 9) {
  const cam = new THREE.PerspectiveCamera(55, aspect, near, 200);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

const MAUVAIS = [NaN, Infinity, -Infinity, -0];

/**
 * Une page de `triangles` triangles posés au hasard dans une dalle. `hostile` remplace une partie
 * des sommets par des valeurs que le chemin chaud doit traverser sans broncher : triangle dégénéré
 * d'aire nulle, sommet derrière la caméra, coordonnée non finie ou zéro négatif.
 */
function page(alea, index, triangles, hostile, material, taille) {
  const positions = new Float32Array(triangles * 3 * 3),
    indices = new Uint32Array(triangles * 3);
  const px = (alea() - 0.5) * 8,
    py = (alea() - 0.5) * 5,
    pz = (alea() - 0.5) * 4;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t++) {
    const degenere = hostile && t % 37 === 0,
      derriere = hostile && t % 53 === 0,
      casse = hostile && t % 101 === 0;
    const cx = px + (alea() - 0.5) * 3,
      cy = py + (alea() - 0.5) * 2,
      cz = pz + (alea() - 0.5) * 0.5;
    for (let v = 0; v < 3; v++) {
      const at = (t * 3 + v) * 3,
        source = degenere ? 0 : v;
      let x = cx + (source - 1) * taille,
        y = cy + (source % 2 ? taille * 0.9 : -taille * 0.9),
        z = cz + (alea() - 0.5) * 0.1;
      if (derriere) z = 30;
      if (casse) x = MAUVAIS[(t + v) % MAUVAIS.length];
      positions[at] = x;
      positions[at + 1] = y;
      positions[at + 2] = z;
      // Sens de parcours inversé : les triangles font face à la caméra, le visbuffer les garde.
      indices[t * 3 + v] = t * 3 + (2 - v);
      for (let axe = 0; axe < 3; axe++) {
        const valeur = positions[at + axe];
        if (Number.isFinite(valeur)) {
          if (valeur < min[axe]) min[axe] = valeur;
          if (valeur > max[axe]) max[axe] = valeur;
        }
      }
    }
  }
  for (let axe = 0; axe < 3; axe++) {
    if (!Number.isFinite(min[axe])) min[axe] = 0;
    if (!Number.isFinite(max[axe])) max[axe] = 0;
  }
  const attributes = { position: new THREE.BufferAttribute(positions, 3) };
  return {
    array: indices,
    attributes,
    matrix: new THREE.Matrix4(),
    material,
    clusterId: `0/0/${index}`,
    url: `page-${index}.bin`,
    min,
    max,
    triangles,
  };
}

/** Une coupe complète : `pages` pages de `triangles` triangles chacune, devant la caméra. */
export function coupe({
  pages = 200,
  triangles = 24,
  hostile = true,
  seed = 7,
  taille = 0.16,
  material,
} = {}) {
  const alea = graine(seed),
    mat = material ?? new THREE.MeshBasicMaterial({ color: 0x88aa44 });
  const liste = [];
  for (let i = 0; i < pages; i++) liste.push(page(alea, i, triangles, hostile, mat, taille));
  return liste;
}

/**
 * Des boîtes seules, sans géométrie : ce que la Hi-Z projette et trie. `degenerees` ajoute la boîte
 * vide, la boîte inversée (min > max), la boîte à l'infini et la boîte qui traverse le plan proche.
 */
export function boites({ count = 20000, seed = 11, degenerees = true } = {}) {
  const alea = graine(seed),
    liste = [];
  for (let i = 0; i < count; i++) {
    const cx = (alea() - 0.5) * 40,
      cy = (alea() - 0.5) * 24,
      cz = -alea() * 80;
    const demi = 0.05 + alea() * 1.5;
    let min = [cx - demi, cy - demi, cz - demi],
      max = [cx + demi, cy + demi, cz + demi];
    if (degenerees && i % 997 === 0) max = [...min];
    if (degenerees && i % 1499 === 0) {
      const echange = min;
      min = max;
      max = echange;
    }
    if (degenerees && i % 2003 === 0) {
      min = [-Infinity, -Infinity, -Infinity];
      max = [Infinity, Infinity, Infinity];
    }
    if (degenerees && i % 311 === 0) {
      min = [cx - demi, cy - demi, -0.05];
      max = [cx + demi, cy + demi, 8];
    }
    liste.push({
      min,
      max,
      matrix: new THREE.Matrix4(),
      url: `boite-${i}.bin`,
      array: new Uint32Array(3 * (1 + (i % 40))),
    });
  }
  return liste;
}

/** Les rectangles écran que `hizTestRect` doit classer : plein écran, vides, hors champ, immenses. */
export function rectangles({ count = 20000, seed = 13, width = 1280, height = 720 } = {}) {
  const alea = graine(seed),
    liste = [];
  for (let i = 0; i < count; i++) {
    const x0 = Math.floor((alea() - 0.2) * width),
      y0 = Math.floor((alea() - 0.2) * height);
    const largeur = Math.floor(alea() ** 4 * width * 2),
      hauteur = Math.floor(alea() ** 4 * height * 2);
    liste.push([x0, y0, x0 + largeur, y0 + hauteur, i % 173 === 0]);
  }
  liste.push([0, 0, width - 1, height - 1, false], [5, 5, 4, 4, false], [0, 0, 0, 0, false]);
  liste.push([-1000, -1000, -999, -999, false], [0, 0, 1 << 20, 1 << 20, false]);
  return liste;
}
