import type { Scene } from './lightingExperimentScene.ts';
import type { TransportOptions } from './lightingTransportContracts.ts';
import { validateScene, fail } from './lightingTransportValidation.ts';
import { SURFACE_STRIDE } from './lightingTransportIntersections.ts';

export function createTransportState(initialScene: Scene, options: TransportOptions) {
  validateScene(initialScene);
  const size = initialScene.patches.length;
  const surfaceCount = initialScene.surfaces.length;
  const raysPerPatch = options.raysPerPatch ?? 64;
  const maxIterations = options.maxIterations ?? 256;
  const tolerance = options.tolerance ?? 1e-7;
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const now = options.now ?? (() => performance.now());
  if (
    !Number.isSafeInteger(raysPerPatch) ||
    raysPerPatch < 4 ||
    raysPerPatch % 4 !== 0 ||
    !Number.isSafeInteger(maxIterations) ||
    maxIterations < 1 ||
    !(tolerance > 0) ||
    !Number.isFinite(tolerance) ||
    !(maxBytes > 0) ||
    !Number.isFinite(maxBytes)
  )
    fail('INVALID_OPTIONS', 'Invalid ray, iteration, tolerance or memory budget');
  const totalRays = size * raysPerPatch;
  const estimatedBytes = size * size * 12 + totalRays * 80 + size * 257 + surfaceCount * 133 + 32;
  if (
    !Number.isSafeInteger(totalRays) ||
    !Number.isSafeInteger(estimatedBytes) ||
    estimatedBytes > maxBytes
  ) {
    fail('MEMORY_BUDGET_EXCEEDED', `Transport typed-array payload exceeds ${maxBytes} bytes`);
  }
  const matrix = new Float64Array(size * size);
  const counts = new Uint32Array(size * size);
  const rays = new Float64Array(totalRays * 6);
  const staticDistance = new Float64Array(totalRays);
  const staticHit = new Int32Array(totalRays);
  const staticUv = new Float64Array(totalRays * 2);
  const firstHit = new Int32Array(totalRays);
  const packed = new Float64Array(surfaceCount * SURFACE_STRIDE).fill(NaN);
  const patchGeometry = new Float64Array(size * 12).fill(NaN);
  const patchChanged = new Uint8Array(size);
  const patchSurface = Int32Array.from(initialScene.patches, (patch) => patch.surface);
  const moving = Uint8Array.from(initialScene.surfaces, (surface) => (surface.moving ? 1 : 0));
  const columns = Int32Array.from(initialScene.surfaces, (surface) => surface.columns);
  const rows = Int32Array.from(initialScene.surfaces, (surface) => surface.rows);
  const surfaceIds = initialScene.surfaces.map((surface) => surface.id);
  const cellOffsets = new Int32Array(surfaceCount);
  const cellPatch = new Int32Array(size);
  const source = new Float64Array(size * 3);
  const albedo = new Float64Array(size * 3);
  const rowSums = new Float64Array(size);
  const radiance = new Float64Array(size * 3);
  const next = new Float64Array(size * 3);
  const irradiance = new Float64Array(size * 3);
  const indirectIrradiance = new Float64Array(size * 3);
  const hit = new Float64Array(4);
  const buffers = [
    matrix,
    counts,
    rays,
    staticDistance,
    staticHit,
    staticUv,
    firstHit,
    packed,
    patchGeometry,
    patchChanged,
    patchSurface,
    moving,
    columns,
    rows,
    cellOffsets,
    cellPatch,
    source,
    albedo,
    rowSums,
    radiance,
    next,
    irradiance,
    indirectIrradiance,
    hit,
  ];
  const bytes = buffers.reduce((sum, value) => sum + value.byteLength, 0);
  if (bytes > maxBytes) fail('MEMORY_BUDGET_EXCEEDED', `Transport arrays need ${bytes} bytes`);

  return {
    size,
    surfaceCount,
    raysPerPatch,
    maxIterations,
    tolerance,
    now,
    totalRays,
    matrix,
    counts,
    rays,
    staticDistance,
    staticHit,
    staticUv,
    firstHit,
    packed,
    patchGeometry,
    patchChanged,
    patchSurface,
    moving,
    columns,
    rows,
    surfaceIds,
    cellOffsets,
    cellPatch,
    source,
    albedo,
    rowSums,
    radiance,
    next,
    irradiance,
    indirectIrradiance,
    hit,
    bytes,
    initialized: false,
    sphereGeometry: null as [number, number, number, number] | null,
  };
}
export type TransportState = ReturnType<typeof createTransportState>;
