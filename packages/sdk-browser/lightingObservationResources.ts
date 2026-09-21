import * as THREE from 'three';
import {
  MAX_SURFACES,
  MAX_CACHE_DIMENSION,
  MAX_EMITTERS,
  type LightingExperimentRenderState,
  type LightingExperimentRayDiagnostics,
} from './lightingObservationContracts.ts';
import { createRectangleBvh } from './lightingRectangleBvh.ts';

/** A float RGBA texture of the engine: its texels, its size, and whether the GPU copy is
 *  behind them. Uploaded by the draw, nearest-filtered, clamped, never mipmapped. */
export type ObservationTexture = {
  data: Float32Array;
  width: number;
  height: number;
  dirty: boolean;
};
const floatTexture = (data: Float32Array, width: number, height: number): ObservationTexture => ({
  data,
  width,
  height,
  dirty: true,
});

export function createObservationResources(state: LightingExperimentRenderState) {
  const domain = state.scene,
    surfaceCount = domain.surfaces.length;
  if (surfaceCount < 1 || surfaceCount > MAX_SURFACES)
    throw new Error(`Lighting experiment requires 1..${MAX_SURFACES} surfaces`);
  // The host scene the backend publishes, by contract: empty, black — no mesh ever enters it,
  // the observation draws on the engine's program.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const patchOffsets: number[] = [],
    tileOffsets: number[] = [];
  let patchCount = 0,
    atlasWidth = 1,
    atlasHeight = 0;
  const expectedIds = domain.surfaces.map((surface) => surface.id);
  const shapes = domain.surfaces.map((surface) => [surface.columns, surface.rows] as const);
  for (const surface of domain.surfaces) {
    if (
      !Number.isInteger(surface.columns) ||
      !Number.isInteger(surface.rows) ||
      surface.columns < 1 ||
      surface.rows < 1
    )
      throw new Error('Invalid lighting experiment patch grid');
    patchOffsets.push(patchCount);
    tileOffsets.push(atlasHeight);
    patchCount += surface.columns * surface.rows;
    atlasWidth = Math.max(atlasWidth, surface.columns);
    atlasHeight += surface.rows;
  }
  if (atlasWidth > MAX_CACHE_DIMENSION || atlasHeight > MAX_CACHE_DIMENSION)
    throw new Error('Lighting experiment cache exceeds the declared texture bound');
  if (domain.patches.length !== patchCount)
    throw new Error('Lighting experiment patch grid does not match scene patches');
  const texels = new Float32Array(atlasWidth * atlasHeight * 4);
  const texture = floatTexture(texels, atlasWidth, atlasHeight);
  const surfaceTexels = new Float32Array(surfaceCount * 6 * 4);
  const surfaceTexture = floatTexture(surfaceTexels, 6, surfaceCount);
  const bvh = createRectangleBvh(domain.surfaces);
  const bvhTexture = floatTexture(bvh.data, 2, bvh.nodeCount);
  const rayDiagnostics: LightingExperimentRayDiagnostics = {
    rayTraversal: 'brute',
    bvhNodeCount: bvh.nodeCount,
    bvhNodeBytes: bvh.data.byteLength,
    bvhRefitMs: 0,
  };
  state.rayDiagnostics = rayDiagnostics;
  /** The program's uniforms, plain values the draw uploads each frame. */
  const uniforms = {
    cacheSize: [atlasWidth, atlasHeight] as [number, number],
    sphere: new Float32Array(4),
    sphereRoughness: 0,
    reflectionSamples: 8,
    experimentExposure: 1,
    emitterCount: 0,
    emitterIndices: new Int32Array(MAX_EMITTERS),
    directLightSamples: 16,
    directLightGrid: 4,
    useBvh: false,
  };
  return {
    surfaceCount,
    scene,
    patchOffsets,
    tileOffsets,
    patchCount,
    atlasWidth,
    atlasHeight,
    expectedIds,
    shapes,
    texels,
    texture,
    surfaceTexels,
    surfaceTexture,
    bvh,
    bvhTexture,
    rayDiagnostics,
    uniforms,
  };
}
export type ObservationResources = ReturnType<typeof createObservationResources>;
