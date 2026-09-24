import { LIGHT_SETTINGS, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { GraphLight, GraphRectLight } from '../../host/graph/light.ts';

/**
 * ONE CONTRACT LIGHT AS A LIGHT OF THE ENGINE'S OWN GRAPH: the WebGL2 path's translation of the
 * store (`contractLights.ts`), light by light, read by the cluster program
 * (`../../webgl/cluster/lights.ts`).
 */

/** A light of the display graph the contract writes. */
export type ContractLight = GraphLight | GraphRectLight;

/** Eye distance of a directional: it has no position, only its direction counts. */
const SUN_DISTANCE = 1;

/** The contract's linear colour, without going through sRGB: that is the working space. */
function applyColor(light: ContractLight, source: SceneLight) {
  light.color.setRGB(source.color[0], source.color[1], source.color[2]);
  light.intensity = source.intensity;
}

/**
 * Penumbra that reproduces the contract cone edge. The WebGPU path softens the cone between
 * `cos(half-angle)` and the larger of `cos(half-angle) + spotEdgeSoftness` and the declared
 * penumbra's inner cosine; Three softens between `cos(angle)` and `cos(angle · (1 − penumbra))`.
 * Equating the cosines gives this penumbra — the same transition, not a neighbouring one.
 */
function spotPenumbra(coneAngle: number, declared = 0) {
  const inner = Math.acos(Math.min(1, Math.cos(coneAngle) + LIGHT_SETTINGS.spotEdgeSoftness));
  return Math.min(1, Math.max(declared, 1 - inner / coneAngle));
}

/** A fresh light of the requested type, with its target when it has one. */
export function createLight(source: SceneLight): ContractLight {
  if (source.kind === 'point') return new GraphLight('point');
  if (source.kind === 'spot') return new GraphLight('spot');
  if (source.kind === 'rect') return new GraphRectLight();
  return new GraphLight('directional');
}

/**
 * Writes a contract light into its light. Units are the contract's, with no adjustment factor:
 * `intensity` is a radiometric intensity in W/sr for a point or a spotlight, and the cluster
 * program with `decay = 2` and `distance = range` applies exactly the deferred-lighting shader
 * attenuation — `pow(clamp(1 − (d/range)⁴, 0, 1), 2) / d²`, term for term. A directional
 * carries an irradiance, the same everywhere.
 *
 * No shadows — see `shadows: false` in the engine capabilities.
 */
export function writeLight(light: ContractLight, source: SceneLight) {
  applyColor(light, source);
  if (light instanceof GraphRectLight) return writeRect(light, source);
  if (source.kind === 'directional') {
    const direction = source.direction!;
    light.position.set(
      -direction[0] * SUN_DISTANCE,
      -direction[1] * SUN_DISTANCE,
      -direction[2] * SUN_DISTANCE,
    );
    light.target!.position.set(0, 0, 0);
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
  light.target!.position.set(
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
function writeRect(light: GraphRectLight, source: SceneLight) {
  const [x, y, z] = source.position!,
    normal = source.direction!,
    [ax, ay, az] = source.right!;
  light.position.set(x, y, z);
  const [bx, by, bz] = [-normal[0], -normal[1], -normal[2]];
  // The basis (across, up, back), columns of a rotation: up = back × across.
  const [ux, uy, uz] = [by * az - bz * ay, bz * ax - bx * az, bx * ay - by * ax];
  light.quaternion.setFromRotationMatrix([ax, ay, az, 0, ux, uy, uz, 0, bx, by, bz, 0, 0, 0, 0, 1]);
  [light.width, light.height] = source.size!;
  light.distance = source.range!;
}
