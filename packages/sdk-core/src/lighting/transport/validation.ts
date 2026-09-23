import type { Scene, Vec3 } from '../scene/experimentScene.ts';
import {
  LightingTransportError,
  type TransportOptions,
  type TransportProgress,
} from './contracts.ts';

export function fail(code: string, message: string): never {
  throw new LightingTransportError(code, message);
}
export function checkpoint(options: Pick<TransportOptions, 'cancelled'>) {
  if (options.cancelled?.()) fail('CANCELLED', 'Transport work cancelled');
}
export function progress(
  options: TransportOptions,
  stage: TransportProgress['stage'],
  completed: number,
  total: number,
) {
  checkpoint(options);
  try {
    options.onProgress?.({ eventVersion: 1, stage, completed, total });
  } catch (error) {
    if (error instanceof LightingTransportError && error.code === 'CANCELLED') throw error;
    // An observer does not own the numerical operation.
  }
  checkpoint(options);
}
function finiteVector(value: Vec3, field: string) {
  if (value.length !== 3 || !value.every(Number.isFinite))
    fail('INVALID_SCENE', `${field} must contain three finite numbers`);
}
export function validateScene(scene: Scene) {
  if (!scene.patches.length || !scene.surfaces.length)
    fail('INVALID_SCENE', 'Transport needs surfaces and patches');
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
    ) {
      fail('INVALID_SCENE', 'Surface subdivision counts must be positive integers');
    }
    count += surface.columns * surface.rows;
  }
  if (count !== scene.patches.length)
    fail('INVALID_SCENE', 'Surface subdivision counts differ from the patch count');
  for (let i = 0; i < scene.patches.length; i++) {
    const patch = scene.patches[i];
    if (patch.id !== i || !Number.isInteger(patch.surface) || !scene.surfaces[patch.surface])
      fail('INVALID_SCENE', 'Patch ids must be their stable array indices');
    for (const key of ['center', 'normal', 'u', 'v', 'albedo', 'emission'] as const)
      finiteVector(patch[key], `patch.${key}`);
    if (!(patch.area > 0) || !Number.isFinite(patch.area))
      fail('INVALID_SCENE', 'Patch area must be positive');
    if (
      patch.albedo.some((value) => value < 0 || value > 1) ||
      patch.emission.some((value) => value < 0)
    ) {
      fail('INVALID_SCENE', 'Albedo must be in [0, 1] and emission must be nonnegative');
    }
    const norm = Math.hypot(patch.normal[0], patch.normal[1], patch.normal[2]);
    if (Math.abs(norm - 1) > 1e-6) fail('INVALID_SCENE', 'Patch normals must be normalized');
  }
  if (scene.sphere) {
    finiteVector(scene.sphere.center, 'sphere.center');
    if (!(scene.sphere.radius > 0) || !Number.isFinite(scene.sphere.radius))
      fail('INVALID_SCENE', 'Sphere radius must be positive');
  }
}
