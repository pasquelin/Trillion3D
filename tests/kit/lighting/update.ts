import {
  MAX_REFLECTION_SAMPLES,
  MAX_EMITTERS,
  type LightingExperimentRenderState,
} from './contracts.ts';
import type { ObservationResources } from './resources.ts';
import type { ObservationMeshes } from './meshes.ts';

export function updateObservation(
  state: LightingExperimentRenderState,
  resources: ObservationResources,
  meshes: ObservationMeshes,
) {
  const {
    surfaceCount,
    patchCount,
    uniforms,
    rayDiagnostics,
    expectedIds,
    shapes,
    surfaceTexels,
    tileOffsets,
    patchOffsets,
    atlasWidth,
    texels,
    bvh,
    bvhTexture,
    texture,
    surfaceTexture,
  } = resources;
  const current = state.scene;
  if (current.surfaces.length !== surfaceCount || current.patches.length !== patchCount)
    throw new Error('Lighting experiment topology cannot change after creation');
  if (
    state.indirectIrradiance.length !== patchCount * 3 ||
    state.radiance.length !== patchCount * 3
  )
    throw new Error('Lighting experiment solver cache size mismatch');
  const samples = state.reflectionSamples ?? MAX_REFLECTION_SAMPLES,
    directSamples = state.directLightSamples ?? 16,
    exposure = state.exposure ?? 1;
  if (!Number.isInteger(samples) || samples < 1 || samples > MAX_REFLECTION_SAMPLES)
    throw new Error('Lighting experiment reflectionSamples must be an integer from 1 to 8');
  if (!Number.isFinite(exposure) || exposure <= 0)
    throw new Error('Lighting experiment exposure must be finite and positive');
  if (directSamples !== 16 && directSamples !== 64)
    throw new Error('Lighting experiment directLightSamples must be 16 or 64');
  const rayTraversal = state.rayTraversal ?? 'brute';
  if (rayTraversal !== 'brute' && rayTraversal !== 'bvh')
    throw new Error('Lighting experiment rayTraversal must be brute or bvh');
  uniforms.reflectionSamples = samples;
  uniforms.experimentExposure = exposure;
  uniforms.directLightSamples = directSamples;
  uniforms.directLightGrid = directSamples === 16 ? 4 : 8;
  uniforms.useBvh = rayTraversal === 'bvh';
  rayDiagnostics.rayTraversal = rayTraversal;
  rayDiagnostics.bvhRefitMs = 0;
  uniforms.emitterCount = 0;
  for (let i = 0; i < surfaceCount; i++) {
    const surface = current.surfaces[i];
    if (
      surface.id !== expectedIds[i] ||
      surface.columns !== shapes[i][0] ||
      surface.rows !== shapes[i][1]
    )
      throw new Error('Lighting experiment surface identity and grid must remain stable');
    const record = i * 24;
    surfaceTexels.set(surface.origin, record);
    surfaceTexels[record + 3] = surface.kind === 'mirror' ? 1 : 0;
    surfaceTexels.set(surface.u, record + 4);
    surfaceTexels.set(surface.v, record + 8);
    surfaceTexels.set(surface.albedo, record + 12);
    surfaceTexels.set(surface.emission, record + 16);
    if (surface.emission.some((value) => value > 0)) {
      if (uniforms.emitterCount >= MAX_EMITTERS)
        throw new Error(`Lighting experiment supports at most ${MAX_EMITTERS} area emitters`);
      uniforms.emitterIndices[uniforms.emitterCount++] = i;
    }
    surfaceTexels[record + 20] = 0;
    surfaceTexels[record + 21] = tileOffsets[i];
    surfaceTexels[record + 22] = surface.columns;
    surfaceTexels[record + 23] = surface.rows;
    for (let row = 0; row < surface.rows; row++)
      for (let column = 0; column < surface.columns; column++) {
        const input = (patchOffsets[i] + row * surface.columns + column) * 3;
        const output = ((tileOffsets[i] + row) * atlasWidth + column) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const value = state.indirectIrradiance[input + channel];
          if (!Number.isFinite(value) || value < 0)
            throw new Error(
              'Lighting experiment indirect irradiance must be finite and nonnegative',
            );
          texels[output + channel] = value;
        }
        texels[output + 3] = 1;
      }
  }
  const sphere = current.sphere;
  if (!sphere) throw new Error('Lighting experiment observation requires the declared sphere');
  if (!Number.isFinite(sphere.roughness) || sphere.roughness < 0 || sphere.roughness > 1)
    throw new Error('Lighting experiment sphere roughness must lie in [0, 1]');
  uniforms.sphere.set(sphere.center);
  uniforms.sphere[3] = sphere.radius;
  uniforms.sphereRoughness = sphere.roughness;
  meshes.updateTransforms();
  if (uniforms.useBvh) {
    const refitStart = performance.now();
    bvh.refit(surfaceTexels);
    rayDiagnostics.bvhRefitMs = performance.now() - refitStart;
    bvhTexture.dirty = true;
  }
  texture.dirty = true;
  surfaceTexture.dirty = true;
}
