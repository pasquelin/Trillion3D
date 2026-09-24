/**
 * The lights of a test scene, built of the engine's own graph (`./light.ts`) with the reference's
 * argument lists and defaults: re-exported by `./graph.fixture.ts`, where tests take them.
 */
import { Color, type ColorInput } from '../../../../sdk-core/src/world/math/color.ts';
import { GraphAmbientLight, GraphLight, GraphLightProbe } from './light.ts';

const colour = (value: ColorInput | undefined) => new Color(value ?? 0xffffff);

/** A light that shines one way from far off. */
export function directionalLight(color?: ColorInput, intensity = 1) {
  const light = new GraphLight('directional', colour(color));
  light.intensity = intensity;
  return light;
}

/** A light that shines every way from a point, fading with distance. */
export function pointLight(color?: ColorInput, intensity = 1, distance = 0, decay = 2) {
  const light = new GraphLight('point', colour(color));
  Object.assign(light, { intensity, distance, decay });
  return light;
}

/** A light that shines in a cone. */
export function spotLight(
  color?: ColorInput,
  intensity = 1,
  distance = 0,
  angle = Math.PI / 3,
  penumbra = 0,
  decay = 2,
) {
  const light = new GraphLight('spot', colour(color));
  Object.assign(light, { intensity, distance, angle, penumbra, decay });
  return light;
}

/** A light that lights every face alike. */
export const ambientLight = (color?: ColorInput, intensity = 1) =>
  new GraphAmbientLight(colour(color), intensity);

/** An environment's irradiance as nine coefficients: what a sky over a ground becomes in the
 *  engine (`addLightIrradiance`, `sdk-core/src/world/light/lightRecord.ts`). */
export function lightProbe(coefficients: ArrayLike<number> = new Float32Array(27), intensity = 1) {
  const probe = new GraphLightProbe();
  probe.sh.fromArray(coefficients);
  probe.intensity = intensity;
  return probe;
}
