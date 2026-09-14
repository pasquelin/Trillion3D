import * as THREE from 'three';
import {
  MAX_SURFACES,
  MAX_CACHE_DIMENSION,
  MAX_EMITTERS,
  type LightingExperimentRenderState,
  type LightingExperimentRayDiagnostics,
} from './lightingObservationContracts.ts';
import { createRectangleBvh } from './lightingRectangleBvh.ts';

function createFloatTexture(data: Float32Array, width: number, height: number) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export function createObservationResources(state: LightingExperimentRenderState) {
  const domain = state.scene,
    surfaceCount = domain.surfaces.length;
  if (surfaceCount < 1 || surfaceCount > MAX_SURFACES)
    throw new Error(`Lighting experiment requires 1..${MAX_SURFACES} surfaces`);
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
  const texture = createFloatTexture(texels, atlasWidth, atlasHeight);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const surfaceTexels = new Float32Array(surfaceCount * 6 * 4);
  const surfaceTexture = createFloatTexture(surfaceTexels, 6, surfaceCount);
  const bvh = createRectangleBvh(domain.surfaces);
  const bvhTexture = createFloatTexture(bvh.data, 2, bvh.nodeCount);
  bvhTexture.needsUpdate = true;
  const rayDiagnostics: LightingExperimentRayDiagnostics = {
    rayTraversal: 'brute',
    bvhNodeCount: bvh.nodeCount,
    bvhNodeBytes: bvh.data.byteLength,
    bvhRefitMs: 0,
  };
  state.rayDiagnostics = rayDiagnostics;
  const uniforms = {
    indirectCache: { value: texture },
    cacheSize: { value: new THREE.Vector2(atlasWidth, atlasHeight) },
    surfaceData: { value: surfaceTexture },
    sphere: { value: new THREE.Vector4() },
    sphereRoughness: { value: 0 },
    reflectionSamples: { value: 8 },
    experimentExposure: { value: 1 },
    emitterCount: { value: 0 },
    emitterIndices: { value: new Int32Array(MAX_EMITTERS) },
    directLightSamples: { value: 16 },
    directLightGrid: { value: 4 },
    bvhData: { value: bvhTexture },
    useBvh: { value: false },
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
    dispose() {
      texture.dispose();
      surfaceTexture.dispose();
      bvhTexture.dispose();
    },
  };
}
export type ObservationResources = ReturnType<typeof createObservationResources>;
