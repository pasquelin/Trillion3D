// Les scènes propres au lot C : celles où le lot A n'avait pas de raison d'aller. Un quadrilatère
// découpé en deux triangles qui partagent leur diagonale est le cas limite du remplissage, et c'est
// lui que le banc doit voir avant les scènes aléatoires.
import * as THREE from 'three';

/**
 * Des quadrilatères découpés en deux triangles qui partagent leur diagonale, posés face à la caméra
 * et centrés : la diagonale passe exactement par le centre des pixels. C'est le cas où le poids vaut
 * exactement zéro, celui que l'arrondi fait basculer — un pixel qui sort des deux triangles est un
 * trou, et un trou n'est pas un arrondi.
 */
export function quadrillage(cotes, demi) {
  const material = new THREE.MeshBasicMaterial({ color: 0x88aa44, side: THREE.DoubleSide });
  const pages = [];
  for (let j = 0; j < cotes; j++)
    for (let i = 0; i < cotes; i++) {
      const cx = (i - (cotes - 1) / 2) * demi * 2,
        cy = (j - (cotes - 1) / 2) * demi * 2;
      const p = [cx - demi, cy - demi, cx + demi, cy + demi];
      const positions = new Float32Array([
        p[0],
        p[1],
        0,
        p[2],
        p[1],
        0,
        p[2],
        p[3],
        0,
        p[0],
        p[3],
        0,
      ]);
      const attributes = { position: new THREE.BufferAttribute(positions, 3) };
      const commun = { attributes, matrix: new THREE.Matrix4(), material };
      pages.push({ ...commun, array: new Uint32Array([0, 1, 2]), clusterId: `q/${j}/${i}/a` });
      pages.push({ ...commun, array: new Uint32Array([0, 2, 3]), clusterId: `q/${j}/${i}/b` });
    }
  return pages;
}
