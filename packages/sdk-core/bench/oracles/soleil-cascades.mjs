// Oracle for point G8: `sceneLightSunCascades.ts` before batch G — bounds recomputed at each
// face —, with the split floor from the "distant shadows" batch, which point G8 does not measure.
import { LIGHT_SETTINGS } from '../../sceneLightContracts.ts';

/** `sceneLightSunCascades.ts`: bounds were recomputed at each face for the same view. */
function sunCascadeSplits(view, out) {
  const count = LIGHT_SETTINGS.sunCascades;
  const camera = Math.max(1e-3, view.near),
    far = Math.max(camera * 1.001, view.far * LIGHT_SETTINGS.sunShadowFarFraction);
  const near = Math.max(camera, far / Math.pow(LIGHT_SETTINGS.sunCascadeRatioMax, count));
  const step = Math.pow(far / near, 1 / count);
  out[0] = camera;
  for (let i = 1; i <= count; i++) out[i] = near * Math.pow(step, i);
}

const splits = new Float64Array(LIGHT_SETTINGS.sunCascades + 1);
const sphere = { distance: 0, radius: 0 };
const cascade = { center: [0, 0, 0], radius: 1, boxCenter: [0, 0, 0] };

function frustumSphere(view, near, far) {
  const tanY = Math.tan(view.halfFovY),
    k2 = tanY * tanY * (1 + view.aspect * view.aspect);
  if (k2 * (far + near) >= far - near) {
    sphere.distance = far;
    sphere.radius = far * Math.sqrt(k2);
    return sphere;
  }
  const span = far - near,
    sum = far + near;
  sphere.distance = 0.5 * sum * (1 + k2);
  sphere.radius =
    0.5 * Math.sqrt(span * span + 2 * (far * far + near * near) * k2 + sum * sum * k2 * k2);
  return sphere;
}

export function referenceSunCascadeOf(view, axis, index, side) {
  sunCascadeSplits(view, splits);
  const { distance, radius } = frustumSphere(view, splits[index], splits[index + 1]);
  const texel = (2 * radius) / Math.max(1, side);
  for (let a = 0; a < 3; a++) {
    const value = view.position[a] + view.forward[a] * distance;
    cascade.center[a] = Math.round(value / texel) * texel;
  }
  cascade.radius = radius;
  const back = (radius * (LIGHT_SETTINGS.sunCascadeDepthScale - 1)) / 2;
  for (let a = 0; a < 3; a++) cascade.boxCenter[a] = cascade.center[a] - axis[a] * back;
  return cascade;
}
