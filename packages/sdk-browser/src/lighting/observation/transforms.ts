import {
  basisMatrix4,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  scaleVector3,
  uniformScaleMatrix4,
} from '../../../../sdk-core/src/index.ts';
import type { LightingExperimentRenderState } from './contracts.ts';

/** Column-major 4×4 basis of a surface or of the sphere, written into an owned buffer. */
export function createObservationTransforms(state: LightingExperimentRenderState) {
  const basis = new Float64Array(16),
    normal = new Float64Array(3);
  const surfaceBasis = (i: number, target: Float64Array) => {
    const { u, v, origin } = state.scene.surfaces[i];
    crossVector3(normal, u, v);
    const area = Math.sqrt(lengthSqVector3(normal)),
      cosine = dotVector3(u, v);
    // Orthogonal within 1e-6 of the edge lengths, compared squared: a threshold, not a number kept.
    if (
      !Number.isFinite(area) ||
      area <= 1e-12 ||
      cosine * cosine > 1e-12 * lengthSqVector3(u) * lengthSqVector3(v)
    )
      throw new Error('Lighting experiment tracing requires finite orthogonal rectangle edges');
    scaleVector3(normal, 1 / area);
    return basisMatrix4(target, u, v, normal, origin);
  };
  const sphereBasis = (target: Float64Array) => {
    const sphere = state.scene.sphere;
    if (!sphere) throw new Error('Lighting experiment observation requires the declared sphere');
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0)
      throw new Error('Invalid lighting experiment sphere radius');
    return uniformScaleMatrix4(target, sphere.radius, sphere.center);
  };
  return { basis, surfaceBasis, sphereBasis };
}
