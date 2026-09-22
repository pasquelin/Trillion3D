import type { SceneLight } from '../../sceneLightContracts.ts';
import {
  addHemisphereIrradiance,
  addIrradianceCoefficients,
  addUniformIrradiance,
} from '../../sceneEnvironment.ts';
import { Vector3 } from '../math/vector3.ts';
import type { Light } from './light.ts';

/** The kinds that are lamps — a position or a direction the engine's light store holds. */
const LAMPS = new Set(['point', 'spot', 'directional', 'rectArea']);
/** The store's spot cone is open on `(0, π/2)`: the widest half-angle it holds, the half-space
 *  less the one float the bound excludes. */
const WIDEST_CONE = Math.PI / 2 - 1e-9;
const eye = new Vector3(),
  aim = new Vector3(),
  right = new Vector3();

/**
 * A lamp as the engine's store holds it (`sceneLightContracts.ts`), placed by its world matrix,
 * or null for a kind the store does not hold or a light giving nothing. `range` is the page's
 * `distance`, or `reach` — what the world derives from its own extent — when the page left it
 * unbounded.
 *
 * A rectangle (`rectArea`) is the store's `rect`: its radiance `intensity`, its face looking down
 * the light's `-z`, its width along the light's `x`, and no cast shadow — the store refuses one.
 */
export function lampRecord(light: Light, id: string, reach: number): SceneLight | null {
  if (!LAMPS.has(light.kind) || !(light.intensity > 0) || !light.visible) return null;
  const rectangle = light.kind === 'rectArea';
  const kind = rectangle ? 'rect' : (light.kind as SceneLight['kind']);
  light.getWorldPosition(eye);
  const record: SceneLight = {
    id,
    kind,
    color: light.color.toArray(),
    intensity: light.intensity,
    castsShadow: light.castShadow && !rectangle,
  };
  if (rectangle) {
    light.getWorldDirection(aim);
    const m = light.matrixWorld.elements;
    record.right = right.set(m[0], m[1], m[2]).normalize().toArray();
    record.size = [light.width, light.height];
  } else if (kind !== 'point') light.target.getWorldPosition(aim).sub(eye);
  if (kind !== 'point')
    record.direction = (aim.lengthSq() > 0 ? aim.normalize() : aim.set(0, -1, 0)).toArray();
  if (kind === 'directional') return record;
  record.position = eye.toArray();
  record.range = light.distance > 0 ? light.distance : reach;
  if (kind === 'spot') {
    record.coneAngle = Math.min(light.angle, WIDEST_CONE);
    if (light.penumbra > 0) record.penumbra = Math.min(1, light.penumbra);
  }
  const radius = rectangle ? 0 : light.radius;
  if (radius > 0 && radius < record.range) record.emitterRadius = radius;
  return record;
}

/**
 * Adds what `light` gives from every direction — its irradiance, a function of the normal alone —
 * to the nine coefficients `sh` (`sceneEnvironment.ts`): an ambient its colour times intensity
 * everywhere; a sky over a ground (`hemisphere`) its colour on normals toward its position seen
 * from the origin and `groundColor` on the opposite ones; a probe its coefficients, or its colour
 * everywhere when it carries none. A lamp adds nothing here. Returns whether it added anything.
 */
export function addLightIrradiance(light: Light, sh: number[]) {
  if (!light.visible || !(light.intensity > 0)) return false;
  const scale = light.intensity;
  const colour = light.color.toArray().map((c) => c * scale);
  if (light.kind === 'ambient' || (light.kind === 'probe' && !light.sh))
    addUniformIrradiance(sh, colour);
  else if (light.kind === 'probe') addIrradianceCoefficients(sh, light.sh!, scale);
  else if (light.kind === 'hemisphere') {
    light.getWorldPosition(aim);
    if (!(aim.lengthSq() > 0)) aim.set(0, 1, 0);
    const ground = light.groundColor.toArray().map((c) => c * scale);
    addHemisphereIrradiance(sh, colour, ground, aim.normalize().toArray());
  } else return false;
  return true;
}
