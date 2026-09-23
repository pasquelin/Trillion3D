// Common tools for tests and volume benchmarks (batch M2): Three.js Box3 built from six
// flat floats and read back flat; the bitwise comparison lives in `tests/kit/assert/bits.ts`.
// Three is only used as a reference, never in a math*.ts file.
import * as THREE from 'three';

/** A Three.js Box3 built from `[minX, minY, minZ, maxX, maxY, maxZ]`. */
export const boite3 = (b: ArrayLike<number>) =>
  new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));

/** Box3 bounds copied flat, in the order of `boite3`. */
export const aPlat = (box: THREE.Box3) =>
  Float64Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
