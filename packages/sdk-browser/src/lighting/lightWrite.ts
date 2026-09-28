import { LIGHT_SETTINGS, type SceneLight } from '../../../sdk-core/src/index.ts';
import { Light } from '../../../sdk-core/src/world/light/light.ts';
import { numbered } from '../host/graph/serial.ts';

/**
 * ONE CONTRACT LIGHT AS A LIGHT OF THE ENGINE'S OWN GRAPH: the WebGL2 path's translation of the
 * store (`contractLights.ts`), light by light, into the core's `Light`, read by the cluster
 * program (`../../webgl/cluster/lights.ts`).
 */

/** Eye distance of a directional: it has no position, only its direction counts. */
const SUN_DISTANCE = 1;

/** The contract's linear colour, without going through sRGB: that is the working space. */
function applyColor(light: Light, source: SceneLight) {
  light.color.setRGB(source.color[0], source.color[1], source.color[2]);
  light.intensity = source.intensity;
}

/**
 * Penumbra that reproduces the contract cone edge. The WebGPU path softens the cone between
 * `cos(half-angle)` and the larger of `cos(half-angle) + spotEdgeSoftness` and the declared
 * penumbra's inner cosine; the reference softens between `cos(angle)` and `cos(angle · (1 − penumbra))`.
 * Equating the cosines gives this penumbra — the same transition, not a neighbouring one. A
 * closed cone takes the limit, 1: both paths then light nothing off the axis, and 0/0 is no NaN.
 */
function spotPenumbra(coneAngle: number, declared = 0) {
  if (!(coneAngle > 0)) return 1;
  const inner = Math.acos(Math.min(1, Math.cos(coneAngle) + LIGHT_SETTINGS.spotEdgeSoftness));
  return Math.min(1, Math.max(declared, 1 - inner / coneAngle));
}

/** A fresh light of the requested type, numbered by the engine; the store's `rect` is the core's
 *  `rectArea`. */
export const createLight = (source: SceneLight) =>
  numbered(new Light(source.kind === 'rect' ? 'rectArea' : source.kind));

/**
 * Writes a contract light into its light. Units are the contract's, with no adjustment factor:
 * `intensity` is a radiometric intensity in W/sr for a point or a spotlight, and the cluster
 * program with `decay = 2` and `distance = range` applies exactly the deferred-lighting shader
 * attenuation — `pow(clamp(1 − (d/range)⁴, 0, 1), 2) / d²`, term for term. A directional
 * carries an irradiance, the same everywhere.
 *
 * No shadows — see `shadows: false` in the engine capabilities.
 */
export function writeLight(light: Light, source: SceneLight) {
  applyColor(light, source);
  if (light.kind === 'rectArea') return writeRect(light, source);
  if (source.kind === 'directional') {
    const direction = source.direction!;
    light.position.set(
      -direction[0] * SUN_DISTANCE,
      -direction[1] * SUN_DISTANCE,
      -direction[2] * SUN_DISTANCE,
    );
    light.target.position.set(0, 0, 0);
    return;
  }
  const position = source.position!;
  light.position.set(position[0], position[1], position[2]);
  light.distance = source.range!;
  light.decay = 2;
  if (source.kind !== 'spot') return;
  light.angle = source.coneAngle!;
  light.penumbra = spotPenumbra(source.coneAngle!, source.penumbra);
  const direction = source.direction!;
  light.target.position.set(
    position[0] + direction[0],
    position[1] + direction[1],
    position[2] + direction[2],
  );
}

/**
 * A rectangle: its centre, its face turned along the contract's normal — the rectangle emits
 * down its own −z — with its width along the contract's `right`, its two sides, its radiance,
 * and its range, at which the cluster program windows the energy as the WebGPU path does.
 */
function writeRect(light: Light, source: SceneLight) {
  const [x, y, z] = source.position!,
    normal = source.direction!,
    [ax, ay, az] = source.right!;
  light.position.set(x, y, z);
  const [bx, by, bz] = [-normal[0], -normal[1], -normal[2]];
  // The basis (across, up, back), columns of a rotation: up = back × across.
  const [ux, uy, uz] = [by * az - bz * ay, bz * ax - bx * az, bx * ay - by * ax];
  light.quaternion.setFromRotationMatrix({
    elements: [ax, ay, az, 0, ux, uy, uz, 0, bx, by, bz, 0, 0, 0, 0, 1],
  });
  [light.width, light.height] = source.size!;
  light.distance = source.range!;
}
