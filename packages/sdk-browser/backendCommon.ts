import { installSceneLighting } from './sceneLighting.ts';
import { clusterHue } from './diagnosticColors.ts';
import type { HostPlaced, HostTraversable } from './hostResources.ts';
import { hslToLinearRgb, type BackendCapabilities } from '../sdk-core/index.ts';
import * as THREE from 'three';

export const DEFAULT_FOV = 55,
  DEFAULT_PIXEL_RATIO = 1,
  DEFAULT_WIDTH = 960,
  DEFAULT_HEIGHT = 540,
  DEFAULT_PAGE_WORKERS = 32,
  PREFETCH_BATCH = 64,
  /** Addresses a frame issues at most, taken from the head of the priority-ordered list. */
  PAGE_REQUEST_BATCH = 256,
  /** Cache pages a frame queues at most in the arrival queue. */
  ARRIVAL_QUEUE_BATCH = 64,
  /** Milliseconds a frame spends at most integrating arrived pages. */
  ARRIVAL_BUDGET_MS = 2,
  /** Main-thread milliseconds of an upload burst before yielding. */
  UPLOAD_SLICE_MS = 2,
  PREFETCH_INTERVAL_MS = 250,
  DEFAULT_CACHED_PAGES = 16384,
  DEFAULT_CLEAR_COLOR = 0x171d28;
/**
 * Device pixels of a logical dimension, at the ratio the host has set. Canvas creation and
 * resize both compute it: two separate truncations would have ended up with a canvas of one
 * size and a viewport of another.
 */
export const devicePixels = (logical: number, pixelRatio: number | undefined) =>
  Math.floor(logical * (pixelRatio ?? DEFAULT_PIXEL_RATIO));
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
    // Light-contract calls exist on the host and do not fail here: they are ignored.
    'contract scene lights with shadow atlas',
    'named node transforms',
    'general mesh LOD simplification',
    'GPU-driven selection/indirect draw',
    'occlusion culling',
    'bounded GPU eviction',
    'physical VRAM instrumentation',
  ],
};
/** Three linear components reread immediately: a cluster colour allocates nothing more. */
const tint = new Float64Array(3);

/** A cluster's hue, computed by the core. The colour object returned is the one host
 *  materials want; its construction is the boundary, not the computation. */
export function clusterColor(id: string, saturation = 0.75) {
  hslToLinearRgb(tint, 0, clusterHue(id), saturation, 0.55);
  return new THREE.Color(tint[0], tint[1], tint[2]);
}
/** An empty node of a host display graph: what a copied light aims at, made here because
 *  making a host object is the boundary's, and posed by the placement that asked for it. */
export const hostAimNode = () => new THREE.Object3D() as unknown as HostPlaced;

/** The display graph a witness publishes: its clear colour, then the source-graph lights
 *  placed on it. Building the host objects is the boundary's, the placement is not. */
export function lighting(scene: THREE.Scene, clearColor: number, source: HostTraversable) {
  scene.background = new THREE.Color(clearColor);
  return installSceneLighting(scene, source, hostAimNode);
}
