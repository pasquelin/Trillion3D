import { installSceneLighting } from './sceneLighting.ts';
import type { BackendCapabilities } from '../sdk-core/index.ts';
import * as THREE from 'three';

export const DEFAULT_FOV = 55,
  DEFAULT_PIXEL_RATIO = 1,
  DEFAULT_WIDTH = 960,
  DEFAULT_HEIGHT = 540,
  DEFAULT_PAGE_WORKERS = 32,
  PREFETCH_BATCH = 64,
  PREFETCH_INTERVAL_MS = 250,
  DEFAULT_CACHED_PAGES = 16384,
  DEFAULT_CLEAR_COLOR = 0x171d28;
export const WEBGPU_REQUIRED_LIMITS = [
  'maxTextureArrayLayers',
  'maxStorageBufferBindingSize',
  'maxBufferSize',
] as const;
export const baseCapabilities: BackendCapabilities = {
  renderer: 'Three.js WebGL2',
  materials: 'Converted glTF PBR, textures, alpha and double-sided flags preserved; no shadow map',
  hierarchy: false,
  gpuDriven: false,
  simplification: false,
  eviction: false,
  unsupported: [
    'general mesh LOD simplification',
    'GPU-driven selection/indirect draw',
    'occlusion culling',
    'bounded GPU eviction',
    'physical VRAM instrumentation',
  ],
};
/** Stable 32-bit hash of a cluster or mesh id, used as a colour seed. */
export function hashId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h;
}
/** Golden-ratio hue of an id, so neighbouring ids get distant colours. */
export function clusterHue(id: string) {
  return (hashId(id) * 0.61803398875) % 1;
}
export function clusterColor(id: string, saturation = 0.75) {
  return new THREE.Color().setHSL(clusterHue(id), saturation, 0.55);
}
export function lighting(scene: THREE.Scene, clearColor: number, source: THREE.Object3D) {
  return installSceneLighting(scene, source, clearColor);
}
