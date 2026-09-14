import type {Scene, Surface, Vec3} from './lightingExperimentScene.ts';

/** Experimental, diffuse-only transport. These versions describe data and algorithms separately. */
export const LIGHTING_TRANSPORT_FORMAT_VERSION = 1;
export const LIGHTING_TRANSPORT_ALGORITHM_VERSION = 'cosine-first-hit-v1';

export interface TransportProgress {
  eventVersion: 1;
  stage: 'geometry' | 'visibility' | 'solve' | 'oracle';
  completed: number;
  total: number;
}
export interface TransportOptions {
  /** Total deterministic rays per patch; four origin samples share this budget. */
  raysPerPatch?: number;
  maxIterations?: number;
  /** Absolute radiance error bound in the maximum norm, for the sampled operator. */
  tolerance?: number;
  /** Reuse the previous radiance in reuse mode (default true). False gives both modes identical solver initialization. */
  warmStart?: boolean;
  maxBytes?: number;
  now?: () => number;
  cancelled?: () => boolean;
  onProgress?: (progress: TransportProgress) => void;
}
export interface TransportSnapshot {
  formatVersion: 1;
  algorithmVersion: typeof LIGHTING_TRANSPORT_ALGORITHM_VERSION;
  patchCount: number;
  /** Row-major form factors: E = pi * matrix * radiance. */
  matrix: Float64Array;
  source: Float64Array;
  albedo: Float64Array;
}
export interface TransportResult {
  formatVersion: 1;
  mode: 'rebuild' | 'reuse';
  /** State-owned arrays, overwritten by later updates. Copy before retaining a frame. */
  radiance: Float64Array;
  /** Incident irradiance from all sampled surfaces, including the emissive panel. */
  irradiance: Float64Array;
  /** Incident irradiance after at least one diffuse reflection: pi * matrix * (radiance - source). */
  indirectIrradiance: Float64Array;
  timings: {rayTraceMs: number; solveMs: number; totalMs: number};
  /** Rays whose static scene intersections were recalculated. */
  raysTraced: number;
  /** Reused static intersections; moving occluders may still have been tested. */
  raysReused: number;
  movingRayTests: number;
  staticSurfaceTests: number;
  totalRays: number;
  rowsUpdated: number;
  iterations: number;
  residual: number;
  errorBound: number;
  contraction: number;
  converged: boolean;
  /** Owned typed-array payload only, excluding JS objects and caller-owned scene data. */
  bytes: number;
  unsupported: readonly ['hierarchical transport', 'adjoint scheduling', 'specular-to-diffuse transport'];
}

export class LightingTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'LightingTransportError';
  }
}

const PI = Math.PI;
const EPSILON = 1e-7;
const SURFACE_STRIDE = 15;
const UNSUPPORTED = ['hierarchical transport', 'adjoint scheduling', 'specular-to-diffuse transport'] as const;

function fail(code: string, message: string): never {
  throw new LightingTransportError(code, message);
}
function checkpoint(options: Pick<TransportOptions, 'cancelled'>) {
  if (options.cancelled?.()) fail('CANCELLED', 'Transport work cancelled');
}
function progress(options: TransportOptions, stage: TransportProgress['stage'], completed: number, total: number) {
  checkpoint(options);
  try { options.onProgress?.({eventVersion: 1, stage, completed, total}); } catch (error) {
    if (error instanceof LightingTransportError && error.code === 'CANCELLED') throw error;
    // An observer does not own the numerical operation.
  }
  checkpoint(options);
}
function finiteVector(value: Vec3, field: string) {
  if (value.length !== 3 || !value.every(Number.isFinite)) fail('INVALID_SCENE', `${field} must contain three finite numbers`);
}
function validateScene(scene: Scene) {
  if (!scene.patches.length || !scene.surfaces.length) fail('INVALID_SCENE', 'Transport needs surfaces and patches');
  let count = 0;
  for (const surface of scene.surfaces) {
    finiteVector(surface.origin, 'surface.origin');
    finiteVector(surface.u, 'surface.u');
    finiteVector(surface.v, 'surface.v');
    if (!Number.isSafeInteger(surface.columns) || surface.columns < 1 || !Number.isSafeInteger(surface.rows) || surface.rows < 1) {
      fail('INVALID_SCENE', 'Surface subdivision counts must be positive integers');
    }
    count += surface.columns * surface.rows;
  }
  if (count !== scene.patches.length) fail('INVALID_SCENE', 'Surface subdivision counts differ from the patch count');
  for (let i = 0; i < scene.patches.length; i++) {
    const patch = scene.patches[i];
    if (patch.id !== i || !Number.isInteger(patch.surface) || !scene.surfaces[patch.surface]) fail('INVALID_SCENE', 'Patch ids must be their stable array indices');
    for (const key of ['center', 'normal', 'u', 'v', 'albedo', 'emission'] as const) finiteVector(patch[key], `patch.${key}`);
    if (!(patch.area > 0) || !Number.isFinite(patch.area)) fail('INVALID_SCENE', 'Patch area must be positive');
    if (patch.albedo.some(value => value < 0 || value > 1) || patch.emission.some(value => value < 0)) {
      fail('INVALID_SCENE', 'Albedo must be in [0, 1] and emission must be nonnegative');
    }
    const norm = Math.hypot(...patch.normal);
    if (Math.abs(norm - 1) > 1e-6) fail('INVALID_SCENE', 'Patch normals must be normalized');
  }
  if (scene.sphere) {
    finiteVector(scene.sphere.center, 'sphere.center');
    if (!(scene.sphere.radius > 0) || !Number.isFinite(scene.sphere.radius)) fail('INVALID_SCENE', 'Sphere radius must be positive');
  }
}

/** Return surface geometry in a fixed buffer, including the inverse Gram matrix for skew rectangles. */
function packSurface(surface: Surface, output: Float64Array, offset: number): boolean {
  const u = surface.u, v = surface.v;
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const uv = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const determinant = uu * vv - uv * uv;
  if (!(determinant > 1e-15)) fail('INVALID_SCENE', 'Surface rectangle is degenerate');
  const values = [
    ...surface.origin, ...u, ...v,
    u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0],
    vv / determinant, -uv / determinant, uu / determinant,
  ];
  let changed = false;
  for (let i = 0; i < SURFACE_STRIDE; i++) {
    changed ||= output[offset + i] !== values[i];
    output[offset + i] = values[i];
  }
  return changed;
}

/** scratch = distance, surface-u, surface-v, front-side flag. */
function intersectSurface(packed: Float64Array, offset: number, rays: Float64Array, ray: number, limit: number, scratch: Float64Array): boolean {
  const ox = rays[ray], oy = rays[ray + 1], oz = rays[ray + 2];
  const dx = rays[ray + 3], dy = rays[ray + 4], dz = rays[ray + 5];
  const nx = packed[offset + 9], ny = packed[offset + 10], nz = packed[offset + 11];
  const denominator = nx * dx + ny * dy + nz * dz;
  if (Math.abs(denominator) < 1e-12) return false;
  const t = (nx * (packed[offset] - ox) + ny * (packed[offset + 1] - oy) + nz * (packed[offset + 2] - oz)) / denominator;
  if (!(t > EPSILON && t < limit)) return false;
  const x = ox + t * dx - packed[offset], y = oy + t * dy - packed[offset + 1], z = oz + t * dz - packed[offset + 2];
  const du = x * packed[offset + 3] + y * packed[offset + 4] + z * packed[offset + 5];
  const dv = x * packed[offset + 6] + y * packed[offset + 7] + z * packed[offset + 8];
  const a = packed[offset + 12] * du + packed[offset + 13] * dv;
  const b = packed[offset + 13] * du + packed[offset + 14] * dv;
  if (a < 0 || a > 1 || b < 0 || b > 1) return false;
  scratch[0] = t; scratch[1] = a; scratch[2] = b; scratch[3] = denominator < 0 ? 1 : 0;
  return true;
}

function intersectSphere(scene: Scene, rays: Float64Array, ray: number, limit: number): number {
  if (!scene.sphere) return limit;
  const {center, radius} = scene.sphere;
  const x = rays[ray] - center[0], y = rays[ray + 1] - center[1], z = rays[ray + 2] - center[2];
  const b = x * rays[ray + 3] + y * rays[ray + 4] + z * rays[ray + 5];
  const discriminant = b * b - (x * x + y * y + z * z - radius * radius);
  if (discriminant < 0) return limit;
  const root = Math.sqrt(discriminant);
  let t = -b - root;
  if (t <= EPSILON) t = -b + root;
  return t > EPSILON && t < limit ? t : limit;
}

function radicalInverse(value: number): number {
  let inverse = 0, place = 0.5;
  while (value > 0) { inverse += (value & 1) * place; value >>>= 1; place *= 0.5; }
  return inverse;
}

function fillPatchRays(scene: Scene, patchIndex: number, count: number, rays: Float64Array) {
  const patch = scene.patches[patchIndex];
  const n = patch.normal;
  const length = Math.hypot(...patch.u);
  if (!(length > 0)) fail('INVALID_SCENE', 'Patch tangent is degenerate');
  const tx = patch.u[0] / length, ty = patch.u[1] / length, tz = patch.u[2] / length;
  const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;
  const directions = count / 4;
  const rotation = (patch.id * 0.6180339887498949) % 1;
  for (let i = 0; i < count; i++) {
    const origin = i % 4, direction = Math.floor(i / 4);
    const a = origin % 2 ? 0.25 : -0.25, b = origin >= 2 ? 0.25 : -0.25;
    const radial = Math.sqrt((direction + 0.5) / directions);
    const phi = 2 * PI * ((radicalInverse(direction) + rotation) % 1);
    const x = radial * Math.cos(phi), y = radial * Math.sin(phi), z = Math.sqrt(1 - radial * radial);
    const offset = (patchIndex * count + i) * 6;
    rays[offset] = patch.center[0] + a * patch.u[0] + b * patch.v[0] + n[0] * EPSILON * 4;
    rays[offset + 1] = patch.center[1] + a * patch.u[1] + b * patch.v[1] + n[1] * EPSILON * 4;
    rays[offset + 2] = patch.center[2] + a * patch.u[2] + b * patch.v[2] + n[2] * EPSILON * 4;
    rays[offset + 3] = tx * x + bx * y + n[0] * z;
    rays[offset + 4] = ty * x + by * y + n[1] * z;
    rays[offset + 5] = tz * x + bz * y + n[2] * z;
  }
}

function maximumResidual(matrix: Float64Array, source: Float64Array, albedo: Float64Array, radiance: Float64Array, size: number): number {
  let maximum = 0;
  for (let i = 0; i < size; i++) {
    let red = 0, green = 0, blue = 0;
    for (let j = 0; j < size; j++) {
      const value = matrix[i * size + j], at = j * 3;
      red += value * radiance[at]; green += value * radiance[at + 1]; blue += value * radiance[at + 2];
    }
    const at = i * 3;
    maximum = Math.max(maximum,
      Math.abs(source[at] + albedo[at] * red - radiance[at]),
      Math.abs(source[at + 1] + albedo[at + 1] * green - radiance[at + 1]),
      Math.abs(source[at + 2] + albedo[at + 2] * blue - radiance[at + 2]));
  }
  return maximum;
}

/**
 * A dense sampled transport experiment, not a hierarchical solver. Both modes use identical rays.
 * Reuse caches intersections with static rectangles, then tests every moving rectangle at its NEW
 * position. Removing an old blocker therefore restores the cached static hit without stale light.
 * Moving source patches recast their own rays. The sphere is an absorbing visibility obstacle;
 * mirror patches must have zero diffuse reflectance. Neither transports specular light into diffuse.
 */
export function createTransport(initialScene: Scene, options: TransportOptions = {}) {
  validateScene(initialScene);
  const size = initialScene.patches.length;
  const surfaceCount = initialScene.surfaces.length;
  const raysPerPatch = options.raysPerPatch ?? 64;
  const maxIterations = options.maxIterations ?? 256;
  const tolerance = options.tolerance ?? 1e-7;
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const now = options.now ?? (() => performance.now());
  if (!Number.isSafeInteger(raysPerPatch) || raysPerPatch < 4 || raysPerPatch % 4 !== 0 ||
      !Number.isSafeInteger(maxIterations) || maxIterations < 1 || !(tolerance > 0) || !Number.isFinite(tolerance) ||
      !(maxBytes > 0) || !Number.isFinite(maxBytes)) fail('INVALID_OPTIONS', 'Invalid ray, iteration, tolerance or memory budget');
  const totalRays = size * raysPerPatch;
  const estimatedBytes = size * size * 12 + totalRays * 80 + size * 257 + surfaceCount * 133 + 32;
  if (!Number.isSafeInteger(totalRays) || !Number.isSafeInteger(estimatedBytes) || estimatedBytes > maxBytes) {
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
  const patchSurface = Int32Array.from(initialScene.patches, patch => patch.surface);
  const moving = Uint8Array.from(initialScene.surfaces, surface => surface.moving ? 1 : 0);
  const columns = Int32Array.from(initialScene.surfaces, surface => surface.columns);
  const rows = Int32Array.from(initialScene.surfaces, surface => surface.rows);
  const surfaceIds = initialScene.surfaces.map(surface => surface.id);
  const cellOffsets = new Int32Array(surfaceCount);
  const cellPatch = new Int32Array(size);
  const source = new Float64Array(size * 3);
  const albedo = new Float64Array(size * 3);
  const rowSums = new Float64Array(size);
  let radiance = new Float64Array(size * 3);
  let next = new Float64Array(size * 3);
  const irradiance = new Float64Array(size * 3);
  const indirectIrradiance = new Float64Array(size * 3);
  const hit = new Float64Array(4);
  let sphereGeometry: [number, number, number, number] | null = null;
  let initialized = false;
  const buffers = [matrix, counts, rays, staticDistance, staticHit, staticUv, firstHit, packed,
    patchGeometry, patchChanged, patchSurface, moving, columns, rows, cellOffsets, cellPatch, source, albedo,
    rowSums, radiance, next, irradiance, indirectIrradiance, hit];
  const bytes = buffers.reduce((sum, value) => sum + value.byteLength, 0);
  if (bytes > maxBytes) fail('MEMORY_BUDGET_EXCEEDED', `Transport arrays need ${bytes} bytes`);

  function patchForHit(surface: number, u: number, v: number, front: boolean) {
    if (!front) return -1;
    const x = Math.min(columns[surface] - 1, Math.max(0, Math.floor(u * columns[surface])));
    const y = Math.min(rows[surface] - 1, Math.max(0, Math.floor(v * rows[surface])));
    return cellPatch[cellOffsets[surface] + y * columns[surface] + x];
  }

  function update(scene: Scene, mode: 'rebuild' | 'reuse'): TransportResult {
    const started = now();
    try {
      checkpoint(options);
      if (mode !== 'rebuild' && mode !== 'reuse') fail('INVALID_OPTIONS', 'Unknown transport update mode');
      validateScene(scene);
      if (scene.patches.length !== size || scene.surfaces.length !== surfaceCount) fail('INCOMPATIBLE_SCENE', 'Patch topology changed; create a new transport state');
      progress(options, 'geometry', 0, surfaceCount);
      let geometryChanged = !initialized, staticChanged = !initialized, cell = 0;
      for (let i = 0; i < surfaceCount; i++) {
        const surface = scene.surfaces[i];
        if (surface.id !== surfaceIds[i] || surface.columns !== columns[i] || surface.rows !== rows[i] || Number(surface.moving) !== moving[i]) {
          fail('INCOMPATIBLE_SCENE', 'Surface identity, subdivision or moving classification changed');
        }
        const changed = packSurface(surface, packed, i * SURFACE_STRIDE);
        geometryChanged ||= changed;
        staticChanged ||= changed && !surface.moving;
        cellOffsets[i] = cell; cell += surface.columns * surface.rows;
      }
      const sphere = scene.sphere;
      const sphereChanged = sphere ? !sphereGeometry || sphere.center.some((value, i) => value !== sphereGeometry![i]) || sphere.radius !== sphereGeometry[3] : sphereGeometry !== null;
      geometryChanged ||= sphereChanged; staticChanged ||= sphereChanged;
      sphereGeometry = sphere ? [sphere.center[0], sphere.center[1], sphere.center[2], sphere.radius] : null;
      cellPatch.fill(-1);
      for (let i = 0; i < size; i++) {
        const patch = scene.patches[i];
        if (patch.surface !== patchSurface[i]) fail('INCOMPATIBLE_SCENE', 'Patch surface identity changed');
        const vectors = [patch.center, patch.normal, patch.u, patch.v];
        let changed = !initialized;
        for (let vector = 0; vector < 4; vector++) for (let axis = 0; axis < 3; axis++) {
          const at = i * 12 + vector * 3 + axis, value = vectors[vector][axis];
          changed ||= patchGeometry[at] !== value; patchGeometry[at] = value;
        }
        patchChanged[i] = changed ? 1 : 0; geometryChanged ||= changed;
        if (changed) fillPatchRays(scene, i, raysPerPatch, rays);
        const at = patch.surface * SURFACE_STRIDE;
        const x = patch.center[0] - packed[at], y = patch.center[1] - packed[at + 1], z = patch.center[2] - packed[at + 2];
        const du = x * packed[at + 3] + y * packed[at + 4] + z * packed[at + 5];
        const dv = x * packed[at + 6] + y * packed[at + 7] + z * packed[at + 8];
        const u = packed[at + 12] * du + packed[at + 13] * dv, v = packed[at + 13] * du + packed[at + 14] * dv;
        const column = Math.floor(u * columns[patch.surface]), row = Math.floor(v * rows[patch.surface]);
        if (column < 0 || column >= columns[patch.surface] || row < 0 || row >= rows[patch.surface]) fail('INVALID_SCENE', 'Patch centre is outside its surface');
        const slot = cellOffsets[patch.surface] + row * columns[patch.surface] + column;
        if (cellPatch[slot] !== -1) fail('INVALID_SCENE', 'Two patches occupy the same surface cell');
        cellPatch[slot] = i;
        for (let c = 0; c < 3; c++) { source[i * 3 + c] = patch.emission[c]; albedo[i * 3 + c] = patch.albedo[c]; }
      }
      if (cellPatch.some(value => value < 0)) fail('INVALID_SCENE', 'Surface subdivision has a missing patch');
      progress(options, 'geometry', surfaceCount, surfaceCount);

      let raysTraced = 0, movingRayTests = 0, staticSurfaceTests = 0, rowsUpdated = 0;
      if (mode === 'rebuild' || geometryChanged) {
        progress(options, 'visibility', 0, size);
        for (let i = 0; i < size; i++) {
          checkpoint(options);
          const rebuildStatic = mode === 'rebuild' || staticChanged || !!patchChanged[i];
          const rebuildRow = mode === 'rebuild' || !initialized;
          let rowChanged = rebuildRow;
          if (rebuildRow) counts.fill(0, i * size, (i + 1) * size);
          for (let sample = 0; sample < raysPerPatch; sample++) {
            if ((sample & 255) === 0) checkpoint(options);
            const ray = i * raysPerPatch + sample, rayOffset = ray * 6;
            if (rebuildStatic) {
              raysTraced++;
              let closest = Infinity, receiver = -1, receiverU = -1, receiverV = -1;
              for (let surface = 0; surface < surfaceCount; surface++) if (!moving[surface]) {
                staticSurfaceTests++;
                if (intersectSurface(packed, surface * SURFACE_STRIDE, rays, rayOffset, closest, hit)) {
                  closest = hit[0]; receiverU = hit[1]; receiverV = hit[2];
                  receiver = patchForHit(surface, hit[1], hit[2], hit[3] !== 0);
                }
              }
              const sphereDistance = intersectSphere(scene, rays, rayOffset, closest);
              if (sphereDistance < closest) { closest = sphereDistance; receiver = -1; receiverU = -1; receiverV = -1; }
              staticDistance[ray] = closest; staticHit[ray] = receiver;
              staticUv[ray * 2] = receiverU; staticUv[ray * 2 + 1] = receiverV;
            }
            let closest = staticDistance[ray], receiver = staticHit[ray];
            if (receiver >= 0) receiver = patchForHit(patchSurface[receiver], staticUv[ray * 2], staticUv[ray * 2 + 1], true);
            for (let surface = 0; surface < surfaceCount; surface++) if (moving[surface]) {
              movingRayTests++;
              if (intersectSurface(packed, surface * SURFACE_STRIDE, rays, rayOffset, closest, hit)) {
                closest = hit[0]; receiver = patchForHit(surface, hit[1], hit[2], hit[3] !== 0);
              }
            }
            if (rebuildRow) {
              if (receiver >= 0) counts[i * size + receiver]++;
            } else if (receiver !== firstHit[ray]) {
              if (firstHit[ray] >= 0) counts[i * size + firstHit[ray]]--;
              if (receiver >= 0) counts[i * size + receiver]++;
              rowChanged = true;
            }
            firstHit[ray] = receiver;
          }
          if (rowChanged) {
            let hits = 0;
            for (let j = 0; j < size; j++) {
              const count = counts[i * size + j]; matrix[i * size + j] = count / raysPerPatch; hits += count;
            }
            rowSums[i] = hits / raysPerPatch; rowsUpdated++;
          }
          if ((i & 15) === 15 || i === size - 1) progress(options, 'visibility', i + 1, size);
        }
      }
      const geometryFinished = now();
      let contraction = 0;
      for (let i = 0; i < size; i++) contraction = Math.max(contraction, rowSums[i] * Math.max(albedo[i * 3], albedo[i * 3 + 1], albedo[i * 3 + 2]));
      if (!(contraction < 1)) fail('NON_CONTRACTIVE_TRANSPORT', 'The sampled operator has no strict maximum-norm contraction bound');
      if (mode === 'rebuild' || !initialized || options.warmStart === false) radiance.fill(0);
      progress(options, 'solve', 0, maxIterations);
      let iterations = 0;
      for (; iterations < maxIterations;) {
        checkpoint(options);
        let delta = 0;
        for (let i = 0; i < size; i++) {
          let red = 0, green = 0, blue = 0;
          for (let j = 0; j < size; j++) {
            const value = matrix[i * size + j], at = j * 3;
            red += value * radiance[at]; green += value * radiance[at + 1]; blue += value * radiance[at + 2];
          }
          const at = i * 3;
          next[at] = source[at] + albedo[at] * red;
          next[at + 1] = source[at + 1] + albedo[at + 1] * green;
          next[at + 2] = source[at + 2] + albedo[at + 2] * blue;
          delta = Math.max(delta, Math.abs(next[at] - radiance[at]), Math.abs(next[at + 1] - radiance[at + 1]), Math.abs(next[at + 2] - radiance[at + 2]));
        }
        const previous = radiance; radiance = next; next = previous; iterations++;
        if (delta <= tolerance * (1 - contraction)) break;
        if ((iterations & 15) === 0) progress(options, 'solve', iterations, maxIterations);
      }
      const residual = maximumResidual(matrix, source, albedo, radiance, size);
      const errorBound = residual / (1 - contraction);
      if (!Number.isFinite(errorBound) || !radiance.every(Number.isFinite)) fail('NUMERICAL_OVERFLOW', 'Transport radiance exceeded finite arithmetic');
      for (let i = 0; i < size; i++) {
        let red = 0, green = 0, blue = 0;
        let indirectRed = 0, indirectGreen = 0, indirectBlue = 0;
        for (let j = 0; j < size; j++) {
          const value = matrix[i * size + j], at = j * 3;
          red += value * radiance[at]; green += value * radiance[at + 1]; blue += value * radiance[at + 2];
          // Remove only emission. An emissive surface can also reflect incoming light.
          indirectRed += value * (radiance[at] - source[at]);
          indirectGreen += value * (radiance[at + 1] - source[at + 1]);
          indirectBlue += value * (radiance[at + 2] - source[at + 2]);
        }
        irradiance[i * 3] = PI * red; irradiance[i * 3 + 1] = PI * green; irradiance[i * 3 + 2] = PI * blue;
        indirectIrradiance[i * 3] = PI * indirectRed;
        indirectIrradiance[i * 3 + 1] = PI * indirectGreen;
        indirectIrradiance[i * 3 + 2] = PI * indirectBlue;
      }
      progress(options, 'solve', iterations, maxIterations);
      initialized = true;
      const finished = now();
      return {formatVersion: 1, mode, radiance, irradiance, indirectIrradiance,
        timings: {rayTraceMs: geometryFinished - started, solveMs: finished - geometryFinished, totalMs: finished - started},
        raysTraced, raysReused: totalRays - raysTraced, movingRayTests, staticSurfaceTests, totalRays, rowsUpdated,
        iterations, residual, errorBound, contraction, converged: errorBound <= tolerance, bytes, unsupported: UNSUPPORTED};
    } catch (error) {
      initialized = false;
      throw error;
    }
  }

  /** Owns fresh copies: later updates cannot change the oracle's input. */
  function snapshot(): TransportSnapshot {
    if (!initialized) fail('NOT_READY', 'Update transport successfully before taking a snapshot');
    return {formatVersion: 1, algorithmVersion: LIGHTING_TRANSPORT_ALGORITHM_VERSION,
      patchCount: size, matrix: matrix.slice(), source: source.slice(), albedo: albedo.slice()};
  }
  return {update, snapshot};
}

/** Independent direct linear solve; never calls the iterative solver. Work is outside measured runs. */
export function solveTransportOracle(snapshot: TransportSnapshot, options: Pick<TransportOptions, 'cancelled' | 'onProgress'> = {}) {
  const size = snapshot.patchCount;
  if (snapshot.formatVersion !== 1 || snapshot.algorithmVersion !== LIGHTING_TRANSPORT_ALGORITHM_VERSION ||
      !Number.isSafeInteger(size) || size < 1 || snapshot.matrix.length !== size * size ||
      snapshot.source.length !== size * 3 || snapshot.albedo.length !== size * 3) fail('INVALID_SNAPSHOT', 'Incompatible transport snapshot');
  if (![snapshot.matrix, snapshot.source, snapshot.albedo].every(values => values.every(Number.isFinite))) fail('INVALID_SNAPSHOT', 'Snapshot contains nonfinite values');
  const matrix = new Float64Array(size * size), rhs = new Float64Array(size), result = new Float64Array(size * 3);
  for (let channel = 0; channel < 3; channel++) {
    checkpoint(options);
    for (let i = 0; i < size; i++) {
      rhs[i] = snapshot.source[i * 3 + channel];
      for (let j = 0; j < size; j++) matrix[i * size + j] = (i === j ? 1 : 0) - snapshot.albedo[i * 3 + channel] * snapshot.matrix[i * size + j];
    }
    for (let pivot = 0; pivot < size; pivot++) {
      if ((pivot & 15) === 0) progress(options, 'oracle', channel * size + pivot, size * 3);
      let winner = pivot;
      for (let row = pivot + 1; row < size; row++) if (Math.abs(matrix[row * size + pivot]) > Math.abs(matrix[winner * size + pivot])) winner = row;
      if (Math.abs(matrix[winner * size + pivot]) < 1e-14) fail('SINGULAR_TRANSPORT', 'Transport oracle encountered a singular system');
      if (winner !== pivot) {
        for (let col = pivot; col < size; col++) {
          const temporary = matrix[pivot * size + col]; matrix[pivot * size + col] = matrix[winner * size + col]; matrix[winner * size + col] = temporary;
        }
        const temporary = rhs[pivot]; rhs[pivot] = rhs[winner]; rhs[winner] = temporary;
      }
      for (let row = pivot + 1; row < size; row++) {
        const factor = matrix[row * size + pivot] / matrix[pivot * size + pivot];
        matrix[row * size + pivot] = 0;
        if (factor === 0) continue;
        for (let col = pivot + 1; col < size; col++) matrix[row * size + col] -= factor * matrix[pivot * size + col];
        rhs[row] -= factor * rhs[pivot];
      }
    }
    for (let row = size - 1; row >= 0; row--) {
      let value = rhs[row];
      for (let col = row + 1; col < size; col++) value -= matrix[row * size + col] * result[col * 3 + channel];
      result[row * 3 + channel] = value / matrix[row * size + row];
    }
  }
  progress(options, 'oracle', size * 3, size * 3);
  return {radiance: result, residual: maximumResidual(snapshot.matrix, snapshot.source, snapshot.albedo, result, size)};
}
