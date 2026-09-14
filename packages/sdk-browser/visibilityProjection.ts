import * as THREE from 'three';

const projectScratch = new THREE.Vector3();

export function projectVisibilityVertex(
  matrix: THREE.Matrix4,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vi: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
) {
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(matrix);
  const e = viewProj.elements;
  const cx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12],
    cy = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13],
    cz = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14],
    cw = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
  if (cw === 0 || !Number.isFinite(cw)) return null;
  const ndcX = cx / cw,
    ndcY = cy / cw,
    ndcZ = cz / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    z: ndcZ * 0.5 + 0.5,
    invW: 1 / cw,
    worldX: v.x,
    worldY: v.y,
    worldZ: v.z,
  };
}

export type Projected = {
  x: number;
  y: number;
  z: number;
  invW: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};
