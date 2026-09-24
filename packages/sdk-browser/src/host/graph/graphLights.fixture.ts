/**
 * The lights of a test scene, built of the engine's own graph (`./light.ts`) with the reference's
 * argument lists and defaults: re-exported by `./graph.fixture.ts`, where tests take them.
 */
import { Color, type ColorInput } from '../../../../sdk-core/src/world/math/color.ts';
import { GraphAmbientLight, GraphLight } from './light.ts';
import { GraphNode } from './node.ts';

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

/**
 * A sky light: one colour from above, another from the ground. The graph builds no kind of its
 * own for it; this node carries the shape the engine reads of one (`../scene/graphNodes.ts`).
 */
export function hemisphereLight(sky?: ColorInput, ground?: ColorInput, intensity = 1) {
  const light = Object.assign(new GraphNode(), {
    isLight: true as const,
    isHemisphereLight: true as const,
    color: colour(sky),
    groundColor: colour(ground),
    intensity,
  });
  light.type = 'HemisphereLight';
  light.position.set(0, 1, 0);
  light.updateMatrix();
  return light;
}
