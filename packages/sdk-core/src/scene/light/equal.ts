import type { SceneEnvironment, SceneLight } from './contracts.ts';

/** Two optional contract vectors: both absent, or identical component by component. */
function sameVector(a: readonly number[] | undefined, b: readonly number[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * True when two validated lights describe exactly the same light — arrays included.
 *
 * A mutation that resets already-held values changes nothing in the image: republishing its revision
 * and the store epoch would restart this light's shadow pages and refuse the held
 * frame, for a pixel-identical result. A host that returns its fixed lights every
 * frame — the common case — would thus pay an invalidation per frame and per light.
 *
 * The identifier is not compared: the two lights are those of the same slot.
 */
export function sameSceneLight(a: SceneLight, b: SceneLight) {
  return (
    a.kind === b.kind &&
    a.intensity === b.intensity &&
    a.castsShadow === b.castsShadow &&
    a.range === b.range &&
    a.coneAngle === b.coneAngle &&
    a.penumbra === b.penumbra &&
    a.emitterRadius === b.emitterRadius &&
    sameVector(a.color, b.color) &&
    sameVector(a.position, b.position) &&
    sameVector(a.direction, b.direction) &&
    sameVector(a.right, b.right) &&
    sameVector(a.size, b.size)
  );
}

/**
 * True when two validated lights cast the same shadow depth: what places, aims and bounds its
 * projection — kind, position, direction, range, cone, a rect's frame and size —, whether it casts
 * at all, and the emitter sphere the depth excludes. Intensity, colour and penumbra only weigh
 * what the shading reads: a change of those neither re-poses the light's shadow nor withdraws a page.
 */
export function sameShadowShape(a: SceneLight, b: SceneLight) {
  return (
    a.kind === b.kind &&
    a.castsShadow === b.castsShadow &&
    a.range === b.range &&
    a.coneAngle === b.coneAngle &&
    a.emitterRadius === b.emitterRadius &&
    sameVector(a.position, b.position) &&
    sameVector(a.direction, b.direction) &&
    sameVector(a.right, b.right) &&
    sameVector(a.size, b.size)
  );
}

/** Same rule for the environment: an exposure reset identically stales no frame. */
export function sameSceneEnvironment(a: SceneEnvironment, b: SceneEnvironment) {
  return (
    a.exposure === b.exposure &&
    a.toneMapping === b.toneMapping &&
    sameVector(a.irradiance, b.irradiance)
  );
}
