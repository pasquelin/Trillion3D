/**
 * The lights of a test scene, the core's `Light` built as the engine builds its own, from
 * positional arguments with fixed defaults: re-exported by `./graph.fixture.ts`, where tests take
 * them.
 */
import type { ColorInput } from '../../../../sdk-core/src/world/math/color.ts'
import { Light } from '../../../../sdk-core/src/world/light/light.ts'

/** A light that shines one way from far off. */
export const directionalLight = (color: ColorInput = 0xffffff, intensity = 1) =>
  new Light('directional', { color, intensity })

/** A light that shines every way from a point, fading with distance. */
export const pointLight = (color: ColorInput = 0xffffff, intensity = 1, distance = 0, decay = 2) =>
  new Light('point', { color, intensity, distance, decay })

/** A light that shines in a cone. */
export const spotLight = (
  color: ColorInput = 0xffffff,
  intensity = 1,
  distance = 0,
  angle = Math.PI / 3,
  penumbra = 0,
  decay = 2,
) => new Light('spot', { color, intensity, distance, angle, penumbra, decay })

/** A light that lights every face alike. */
export const ambientLight = (color: ColorInput = 0xffffff, intensity = 1) =>
  new Light('ambient', { color, intensity })

/** An environment's irradiance as nine coefficients: what a sky over a ground becomes in the
 *  engine (`addLightIrradiance`, `sdk-core/src/world/light/lightRecord.ts`). */
export const lightProbe = (coefficients: ArrayLike<number> = new Float32Array(27), intensity = 1) =>
  new Light('probe', { sh: coefficients, intensity })

/** A light that aims or reaches: directional, point or spot. */
export const isPlacedLight = (node: object): node is Light =>
  node instanceof Light &&
  (node.kind === 'directional' || node.kind === 'point' || node.kind === 'spot')
