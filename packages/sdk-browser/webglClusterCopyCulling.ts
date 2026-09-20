import { boxTransform, clipPlanesFromMatrix, frustumExcludesBox } from '../sdk-core/index.ts';
import { multiplyMatrix4 } from './webglClusterMatrices.ts';
import type { HostDrawCamera } from './cameraWorld.ts';

/** What the cull reads of a scene copy: its declared culling, its local bounds, its placement. */
type CulledCopy = {
  frustumCulled: boolean;
  matrix: { elements: ArrayLike<number> };
  geometry: {
    boundingBox: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    computeBoundingBox(): void;
  };
};

/**
 * Frustum test of the scene copies the owner draws, the one the host renderer would apply: a
 * copy declared `frustumCulled` is skipped when its world box leaves the frustum. What it
 * saves is not the copy's draw alone but the backdrop pass a transmissive copy asks for.
 */
export class WebglClusterCopyCulling {
  private viewProjection = new Float32Array(16);
  private planes = new Float64Array(24);
  private local = new Float64Array(6);
  private world = new Float64Array(6);
  /** Reads the frame's frustum once; the copies are then tested against it. */
  begin(camera: HostDrawCamera) {
    multiplyMatrix4(this.viewProjection, camera.projection, camera.view);
    clipPlanesFromMatrix(this.planes, this.viewProjection);
  }
  visible(copy: CulledCopy) {
    if (!copy.frustumCulled) return true;
    if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox();
    const box = copy.geometry.boundingBox!,
      local = this.local,
      world = this.world;
    local[0] = box.min.x;
    local[1] = box.min.y;
    local[2] = box.min.z;
    local[3] = box.max.x;
    local[4] = box.max.y;
    local[5] = box.max.z;
    boxTransform(world, 0, local, 0, copy.matrix.elements);
    return !frustumExcludesBox(
      this.planes,
      world[0],
      world[1],
      world[2],
      world[3],
      world[4],
      world[5],
    );
  }
}
