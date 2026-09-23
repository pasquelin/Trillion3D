// Oracles for batch F, vector side of sdk-core: `lightingSceneMath.ts:15` and
// `lightingTransportValidation.ts:68` copied as is. Point F20 on `sceneLightShadowFaces.ts`
// (`multiply4`) is non-applicable: the shadows batch on develop removed this function.
import type {
  Patch,
  Scene,
} from '../../../packages/sdk-core/src/lighting/scene/experimentScene.ts';

/** `lightingSceneMath.ts` before batch F: length was computed via argument spreading. */
export const referenceLength = (v: readonly number[]) => Math.hypot(...v);

/** `lightingTransportValidation.ts` before batch F: same spreading on a facet's normal.
 *  The full validation is copied: it is what the benchmark calls. */
function finiteVector(value: readonly number[], field: string) {
  if (value.length !== 3 || !value.every(Number.isFinite))
    throw new Error(`${field} must contain three finite numbers`);
}

const PATCH_VECTOR_KEYS = ['center', 'normal', 'u', 'v', 'albedo', 'emission'] as const;

export function referenceValidateScene(scene: Scene) {
  if (!scene.patches.length || !scene.surfaces.length)
    throw new Error('Transport needs surfaces and patches');
  let count = 0;
  for (const surface of scene.surfaces) {
    finiteVector(surface.origin, 'surface.origin');
    finiteVector(surface.u, 'surface.u');
    finiteVector(surface.v, 'surface.v');
    if (
      !Number.isSafeInteger(surface.columns) ||
      surface.columns < 1 ||
      !Number.isSafeInteger(surface.rows) ||
      surface.rows < 1
    )
      throw new Error('Surface subdivision counts must be positive integers');
    count += surface.columns * surface.rows;
  }
  if (count !== scene.patches.length)
    throw new Error('Surface subdivision counts differ from the patch count');
  for (let i = 0; i < scene.patches.length; i++) {
    const patch: Patch = scene.patches[i];
    if (patch.id !== i || !Number.isInteger(patch.surface) || !scene.surfaces[patch.surface])
      throw new Error('Patch ids must be their stable array indices');
    for (const key of PATCH_VECTOR_KEYS) finiteVector(patch[key], `patch.${key}`);
    if (!(patch.area > 0) || !Number.isFinite(patch.area))
      throw new Error('Patch area must be positive');
    if (
      patch.albedo.some((value) => value < 0 || value > 1) ||
      patch.emission.some((value) => value < 0)
    )
      throw new Error('Albedo must be in [0, 1] and emission must be nonnegative');
    const norm = Math.hypot(...patch.normal);
    if (Math.abs(norm - 1) > 1e-6) throw new Error('Patch normals must be normalized');
  }
  if (scene.sphere) {
    finiteVector(scene.sphere.center, 'sphere.center');
    if (!(scene.sphere.radius > 0) || !Number.isFinite(scene.sphere.radius))
      throw new Error('Sphere radius must be positive');
  }
}
