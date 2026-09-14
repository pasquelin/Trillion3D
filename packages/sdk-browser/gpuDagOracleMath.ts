import * as THREE from 'three';
import type { SelectionUniforms } from './gpuSelection.ts';

export const dagScratch = {
  view: new THREE.Matrix4(),
  world: new THREE.Matrix4(),
  viewMatrix: new THREE.Matrix4(),
  cam: new THREE.PerspectiveCamera(),
  cone: { axis: [0, 0, 1] as [number, number, number], angle: Math.PI },
  min: [0, 0, 0] as number[],
  max: [0, 0, 0] as number[],
  planes: new Float64Array(24),
};

export function objectPlanes(
  uniforms: SelectionUniforms,
  world: THREE.Matrix4,
  into: Float64Array,
) {
  const m = world.elements,
    source = uniforms.planes;
  for (let i = 0; i < 6; i++) {
    const a = source[i * 4],
      b = source[i * 4 + 1],
      c = source[i * 4 + 2],
      d = source[i * 4 + 3];
    into[i * 4] = m[0] * a + m[1] * b + m[2] * c + m[3] * d;
    into[i * 4 + 1] = m[4] * a + m[5] * b + m[6] * c + m[7] * d;
    into[i * 4 + 2] = m[8] * a + m[9] * b + m[10] * c + m[11] * d;
    into[i * 4 + 3] = m[12] * a + m[13] * b + m[14] * c + m[15] * d;
  }
}
export function outsidePlanes(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0)
      return true;
  }
  return false;
}
export function projectedError(
  error: number,
  sx: number,
  sy: number,
  sz: number,
  radius: number,
  e: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  if (error === 0) return 0;
  if (!(error > 0)) return Infinity;
  const vx = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
  const vy = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
  const vz = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
  const distance = Math.sqrt(vx * vx + vy * vy + vz * vz) - radius * stretch;
  if (!(distance > near)) return Infinity;
  return (error * stretch * focal) / distance;
}
