import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { LIGHT_SETTINGS, type SceneLight } from '../sdk-core/index.ts';

/**
 * ONE CONTRACT LIGHT AS A THREE LIGHT: the WebGL2 path's translation of the store
 * (`exactPagesContractLights.ts`), light by light.
 */

/** Eye distance of a directional: it has no position, only its direction counts. */
const SUN_DISTANCE = 1;
let rectTablesInstalled = false;

/** The contract's linear colour, without going through sRGB: that is the working space. */
function applyColor(light: THREE.Light, source: SceneLight) {
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

/** A fresh Three light of the requested type, with its target when it has one. A rectangle
 *  is the host's own area light, whose precomputed tables the host installs once. */
export function createLight(source: SceneLight): THREE.Light {
  if (source.kind === 'point') return new THREE.PointLight();
  if (source.kind === 'spot') return new THREE.SpotLight();
  if (source.kind === 'rect') {
    if (!rectTablesInstalled) RectAreaLightUniformsLib.init();
    rectTablesInstalled = true;
    return new THREE.RectAreaLight();
  }
  return new THREE.DirectionalLight();
}

/**
 * Writes a contract light into its Three light. Units are the contract's, with no adjustment
 * factor: `intensity` is a radiometric intensity in W/sr for a point or a spotlight, and Three
 * with `decay = 2` and `distance = range` applies exactly the deferred-lighting shader
 * attenuation — `pow(clamp(1 − (d/range)⁴, 0, 1), 2) / d²`, term for term. A directional
 * carries an irradiance, the same everywhere, and Three does the same.
 *
 * What is not equalised and does not claim to be: the surface model. Three evaluates a
 * Cook-Torrance of its own, the WebGPU path its own; incident irradiance is the same, the
 * image is not. No shadows either — see `shadows: false` in the engine capabilities.
 */
export function writeLight(light: THREE.Light, source: SceneLight) {
  applyColor(light, source);
  if (source.kind === 'rect') return writeRect(light as THREE.RectAreaLight, source);
  if (source.kind === 'directional') {
    const direction = source.direction!;
    light.position.set(
      -direction[0] * SUN_DISTANCE,
      -direction[1] * SUN_DISTANCE,
      -direction[2] * SUN_DISTANCE,
    );
    (light as THREE.DirectionalLight).target.position.set(0, 0, 0);
    return;
  }
  const position = source.position!;
  light.position.set(position[0], position[1], position[2]);
  const punctual = light as THREE.PointLight;
  punctual.distance = source.range!;
  punctual.decay = 2;
  if (source.kind !== 'spot') return;
  const spot = light as THREE.SpotLight;
  spot.angle = source.coneAngle!;
  spot.penumbra = spotPenumbra(source.coneAngle!, source.penumbra);
  const direction = source.direction!;
  spot.target.position.set(
    position[0] + direction[0],
    position[1] + direction[1],
    position[2] + direction[2],
  );
}

/**
 * A rectangle: its centre, its face turned along the contract's normal — the host's area light
 * emits down its own −z — with its width along the contract's `right`, its two sides, and its
 * radiance, which is the host's area-light intensity. No range: the host's area light has none,
 * where the WebGPU path windows the energy at the range (`directRectLightWgsl.ts`).
 */
function writeRect(light: THREE.RectAreaLight, source: SceneLight) {
  const [x, y, z] = source.position!,
    normal = source.direction!,
    right = source.right!;
  light.position.set(x, y, z);
  const across = new THREE.Vector3(...right),
    back = new THREE.Vector3(-normal[0], -normal[1], -normal[2]);
  const up = new THREE.Vector3().crossVectors(back, across);
  light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, back));
  [light.width, light.height] = source.size!;
}
