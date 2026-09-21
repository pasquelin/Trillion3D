// Scenes specific to batch C: those batch A had no reason to visit. A quad split into two
// triangles that share their diagonal is the fill's edge case, and it is the one the bench
// must see before the random scenes.
import * as THREE from 'three';

/**
 * Quads split into two triangles that share their diagonal, facing the camera
 * and centred: the diagonal passes exactly through pixel centres. That is the case where the
 * weight is exactly zero, the one rounding flips — a pixel that leaves both triangles is a
 * hole, and a hole is not rounding.
 */
export function quadrillage(cotes: number, demi: number) {
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
