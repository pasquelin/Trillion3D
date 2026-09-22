/**
 * The frame constants and the capability sheet every engine shares: sizes, budgets, batch
 * ceilings. Nothing here builds or reads a host object, so this module names no rendering
 * library — the host-library objects a witness publishes live in `hostSceneObjects.ts`.
 */
import type { BackendCapabilities } from '../sdk-core/index.ts';

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
