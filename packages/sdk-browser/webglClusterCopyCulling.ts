import {
  BOX_VALUES,
  boxTransform,
  clipPlanesFromMatrix,
  FRUSTUM_PLANE_VALUES,
  frustumExcludesBox,
} from '../sdk-core/index.ts';
import { multiplyMatrix4 } from './webglClusterMatrices.ts';
import { readThreeBox } from './threeBounds.ts';
import type { HostDrawCamera } from './cameraWorld.ts';

/** What the cull reads of a scene copy: its declared culling, its local bounds, its placement. */
type CulledCopy = {
  frustumCulled: boolean;
  matrix: { elements: ArrayLike<number> };
  geometry: { boundingBox: Parameters<typeof readThreeBox>[1] | null; computeBoundingBox(): void };
};

/**
 * Frustum test of the scene copies the owner draws, the one the host renderer would apply: a
 * copy declared `frustumCulled` is skipped when its world box leaves the frustum. What it
 * saves is not the copy's draw alone but the backdrop pass a transmissive copy asks for.
 */
export class WebglClusterCopyCulling {
  private viewProjection = new Float32Array(16);
  private planes = new Float64Array(FRUSTUM_PLANE_VALUES);
  private box = new Float64Array(BOX_VALUES);
  /** Reads the frame's frustum once; the copies are then tested against it. */
  begin(camera: HostDrawCamera) {
    multiplyMatrix4(this.viewProjection, camera.projection, camera.view);
    clipPlanesFromMatrix(this.planes, this.viewProjection);
  }
  visible(copy: CulledCopy) {
    if (!copy.frustumCulled) return true;
    if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox();
    const box = this.box;
    readThreeBox(box, copy.geometry.boundingBox!);
    boxTransform(box, 0, box, 0, copy.matrix.elements);
    return !frustumExcludesBox(this.planes, box[0], box[1], box[2], box[3], box[4], box[5]);
  }
}
