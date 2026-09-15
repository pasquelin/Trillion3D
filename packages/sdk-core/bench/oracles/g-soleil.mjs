// Oracle du point G8 : `sceneLightSunCascades.ts` avant le lot G, recopié tel quel.
import { LIGHT_SETTINGS } from '../../sceneLightContracts.ts';

/** `sceneLightSunCascades.ts` : les bornes étaient refaites à chaque face, pour la même vue. */
function sunCascadeSplits(view, out) {
  const count = LIGHT_SETTINGS.sunCascades;
  const near = Math.max(1e-3, view.near),
    far = Math.max(near * 1.001, view.far * LIGHT_SETTINGS.sunShadowFarFraction);
  const lambda = LIGHT_SETTINGS.sunCascadeLambda;
  out[0] = near;
  for (let i = 1; i <= count; i++) {
    const ratio = i / count;
    const log = near * Math.pow(far / near, ratio),
      uniform = near + (far - near) * ratio;
    out[i] = lambda * log + (1 - lambda) * uniform;
  }
}

const splits = new Float64Array(LIGHT_SETTINGS.sunCascades + 1);
const sphere = { distance: 0, radius: 0 };
const cascade = { center: [0, 0, 0], radius: 1, boxCenter: [0, 0, 0], boxRadius: 1 };

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
  const halfDepth = (radius * (LIGHT_SETTINGS.sunCascadeDepthScale + 1)) / 2;
  cascade.boxRadius = Math.hypot(radius, radius, halfDepth);
  return cascade;
}
