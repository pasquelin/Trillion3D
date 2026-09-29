import { boxCornersInto, IDENTITY_MATRIX4, invertMatrix4 } from '../../../../sdk-core/src/index.ts';
import { projectCornersInto } from '../../hiz/corners.ts';
import { readHostBox } from '../../host/boxBounds.ts';
import type { HostBox } from '../../host/resources.ts';
import type { EngineCamera } from '../../camera/world.ts';
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts';
import type { BlendGpuItem } from '../blend/state.ts';
import { VOLUME_WORDS, waterRankOf } from '../transparent/transmission.ts';
import { encloseTransform, ROUND, widenBox } from './precision.ts';

export function createWaterBounds() {
  return {
    active: false,
    width: 0,
    height: 0,
    camera: undefined as EngineCamera | undefined,
    surface: new Float64Array(4),
    backdrop: new Float64Array(4),
    projection: new Float32Array(16),
    inverse: new Float32Array(16),
    matrix: new Float32Array(16),
    inverseScratch: new Float64Array(16),
    local: new Float64Array(6),
    world: new Float64Array(6),
    ndc: new Float64Array(6),
    reconstructed: new Float64Array(6),
    error: new Float64Array(3),
    corners: new Float64Array(24),
    projected: new Float64Array(6),
    rect: new Float64Array(4),
  };
}
export type WaterBounds = ReturnType<typeof createWaterBounds>;

export function beginWaterBounds(
  b: WaterBounds,
  camera?: EngineCamera,
  projection?: ArrayLike<number>,
  size?: readonly number[],
) {
  b.active = !!(camera && projection && size && size[0] > 0 && size[1] > 0);
  if (!b.active) return;
  b.camera = camera;
  b.width = size![0];
  b.height = size![1];
  b.surface[0] = b.backdrop[0] = b.width;
  b.surface[1] = b.backdrop[1] = b.height;
  b.surface[2] = b.surface[3] = b.backdrop[2] = b.backdrop[3] = 0;
  b.projection.set(projection!);
  // The deferred uniform inverts the original double render matrix, then stores binary32.
  invertMatrix4(b.inverseScratch, projection!);
  b.inverse.set(b.inverseScratch);
}
function full(b: WaterBounds, rect: Float64Array) {
  rect[0] = rect[1] = 0;
  rect[2] = b.width;
  rect[3] = b.height;
}
function union(into: Float64Array, rect: Float64Array) {
  into[0] = Math.min(into[0], rect[0]);
  into[1] = Math.min(into[1], rect[1]);
  into[2] = Math.max(into[2], rect[2]);
  into[3] = Math.max(into[3], rect[3]);
}
/** Reuse the Hi-Z projector, inflating its rectangle by the derived shader arithmetic error.
 * One additional pixel encloses the rasterizer's subpixel edge snapping, not world precision. */
function project(b: WaterBounds, box: Float64Array) {
  if (!encloseTransform(b.ndc, box, b.projection, b.error)) return false;
  boxCornersInto(b.corners, 0, box[0], box[1], box[2], box[3], box[4], box[5], IDENTITY_MATRIX4);
  projectCornersInto(
    b.corners,
    0,
    b.camera!.view,
    b.projection,
    b.camera!.near,
    b.width,
    b.height,
    b.projected,
    0,
  );
  if (b.projected[5]) return false;
  const dx = Math.ceil((b.error[0] * b.width) / 2 + ROUND * b.width) + 1;
  const dy = Math.ceil((b.error[1] * b.height) / 2 + ROUND * b.height) + 1;
  b.rect[0] = Math.max(0, Math.min(b.width - 1, b.projected[0] - dx));
  b.rect[1] = Math.max(0, Math.min(b.height - 1, b.projected[1] - dy));
  b.rect[2] = Math.max(1, Math.min(b.width, b.projected[2] + dx));
  b.rect[3] = Math.max(1, Math.min(b.height, b.projected[3] + dy));
  return b.rect.every(Number.isFinite);
}

/** Reads the item's local box, widened, and its binary32 matrix; false for a non-affine one. */
function affineSurface(b: WaterBounds, local: HostBox, matrix: ArrayLike<number>) {
  readHostBox(b.local, local);
  widenBox(b.local);
  b.matrix.set(matrix);
  return b.matrix[3] === 0 && b.matrix[7] === 0 && b.matrix[11] === 0 && b.matrix[15] === 1;
}

/** Scissors `pass` to `rect` (min x, min y, max x, max y). */
export function scissorTo(pass: GPURenderPassEncoder, rect: Float64Array) {
  pass.setScissorRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
}

/** Called only for the frustum walk's kept transmissive items. Unknown/deformed geometry
 * keeps full coverage, including unsupported quantized-page water. */
export function includeWaterItem(b: WaterBounds, item: BlendGpuItem, volumes: Float32Array) {
  if (!b.active) return;
  const local = item.sourceGeometry?.boundingBox;
  if (
    !item.bounds ||
    !local ||
    item.flags & FLAG_CLUSTER_PAGE ||
    item.surface.lineWidth ||
    item.surface.sprite ||
    !item.bounds.every(Number.isFinite) ||
    !affineSurface(b, local, item.matrix.elements) ||
    !encloseTransform(b.world, b.local, b.matrix, b.error) ||
    !project(b, b.world)
  ) {
    full(b, b.surface);
    full(b, b.backdrop);
    return;
  }
  union(b.surface, b.rect);
  const thickness = volumes[(waterRankOf(item.flags) - 1) * VOLUME_WORDS + 2];
  if (!Number.isFinite(thickness)) {
    full(b, b.backdrop);
    return;
  }
  // worldAt reconstructs from pixel centres and interpolated depth, not from the source box.
  // Enclose the entire projected depth/XY box, then the inverse uniform's arithmetic.
  b.ndc[0] = Math.min(b.ndc[0], (2 * b.rect[0]) / b.width - 1);
  b.ndc[1] = Math.min(b.ndc[1], 1 - (2 * b.rect[3]) / b.height);
  b.ndc[3] = Math.max(b.ndc[3], (2 * b.rect[2]) / b.width - 1);
  b.ndc[4] = Math.max(b.ndc[4], 1 - (2 * b.rect[1]) / b.height);
  widenBox(b.ndc);
  if (!encloseTransform(b.reconstructed, b.ndc, b.inverse, b.error)) {
    full(b, b.backdrop);
    return;
  }
  // Normalization, P + dir * path and the pixel conversion also round in binary32. The
  // normalized component's error is bounded by the same operation-count guard as the matrices.
  widenBox(b.reconstructed, Math.max(0, thickness) * (1 + 16 * ROUND));
  if (!project(b, b.reconstructed)) full(b, b.backdrop);
  else {
    union(b.backdrop, b.rect);
    union(b.backdrop, b.surface);
  }
}
