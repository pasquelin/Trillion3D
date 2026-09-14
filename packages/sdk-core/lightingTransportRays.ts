import type { Scene } from './lightingExperimentScene.ts';
import { fail } from './lightingTransportValidation.ts';
import { EPSILON } from './lightingTransportIntersections.ts';
const PI = Math.PI;

function radicalInverse(value: number): number {
  let inverse = 0,
    place = 0.5;
  while (value > 0) {
    inverse += (value & 1) * place;
    value >>>= 1;
    place *= 0.5;
  }
  return inverse;
}

export function fillPatchRays(scene: Scene, patchIndex: number, count: number, rays: Float64Array) {
  const patch = scene.patches[patchIndex];
  const n = patch.normal;
  const length = Math.hypot(...patch.u);
  if (!(length > 0)) fail('INVALID_SCENE', 'Patch tangent is degenerate');
  const tx = patch.u[0] / length,
    ty = patch.u[1] / length,
    tz = patch.u[2] / length;
  const bx = n[1] * tz - n[2] * ty,
    by = n[2] * tx - n[0] * tz,
    bz = n[0] * ty - n[1] * tx;
  const directions = count / 4;
  const rotation = (patch.id * 0.6180339887498949) % 1;
  for (let i = 0; i < count; i++) {
    const origin = i % 4,
      direction = Math.floor(i / 4);
    const a = origin % 2 ? 0.25 : -0.25,
      b = origin >= 2 ? 0.25 : -0.25;
    const radial = Math.sqrt((direction + 0.5) / directions);
    const phi = 2 * PI * ((radicalInverse(direction) + rotation) % 1);
    const x = radial * Math.cos(phi),
      y = radial * Math.sin(phi),
      z = Math.sqrt(1 - radial * radial);
    const offset = (patchIndex * count + i) * 6;
    rays[offset] = patch.center[0] + a * patch.u[0] + b * patch.v[0] + n[0] * EPSILON * 4;
    rays[offset + 1] = patch.center[1] + a * patch.u[1] + b * patch.v[1] + n[1] * EPSILON * 4;
    rays[offset + 2] = patch.center[2] + a * patch.u[2] + b * patch.v[2] + n[2] * EPSILON * 4;
    rays[offset + 3] = tx * x + bx * y + n[0] * z;
    rays[offset + 4] = ty * x + by * y + n[1] * z;
    rays[offset + 5] = tz * x + bz * y + n[2] * z;
  }
}
