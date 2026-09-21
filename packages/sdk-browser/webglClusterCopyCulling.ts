import {
  BOX_VALUES,
  boxTransform,
  clipPlanesFromMatrix,
  FRUSTUM_PLANE_VALUES,
  frustumExcludesBox,
} from '../sdk-core/index.ts';
import { multiplyMatrix4 } from './webglClusterMatrices.ts';
import { readThreeBox } from './threeBounds.ts';
import { isTransmissive } from './visibilityMaterial.ts';
import { firstMaterial } from './materialSide.ts';
import type { HostDrawCamera } from './cameraWorld.ts';
import type { WholeMesh } from './clusterBatchMesh.ts';

/** What the cull reads of a scene copy: its declared culling, its local bounds, its placement. */
type CulledCopy = {
  frustumCulled: boolean;
  matrix: { elements: ArrayLike<number> };
  geometry: { boundingBox: Parameters<typeof readThreeBox>[1] | null; computeBoundingBox(): void };
};
/** A scene copy the owner draws: a host mesh drawn whole, culled as the host would. */
export type SceneCopy = WholeMesh & CulledCopy;

/**
 * Frustum test of the scene copies the owner draws, the one the host renderer would apply: a
 * copy declared `frustumCulled` is skipped when its world box leaves the frustum. What it
 * saves is not the copy's draw alone but the backdrop pass a transmissive copy asks for.
 */
class WebglClusterCopyCulling {
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

const isBlended = (material: WholeMesh['material']) => !!firstMaterial(material)?.transparent;

/**
 * The scene copies of one frame, in view, by pass, the classification the reference applies to
 * a mesh at its draw: a copy transmits; or it blends, drawn after the transmissive ones and
 * outside the backdrop; or it is plain — one a diagnostic mode painted, or that stopped
 * transmitting — drawn as a whole mesh with the clusters, never through the transmission pass
 * without transmission. The three lists are reused frame to frame.
 */
export class WebglClusterCopies<Copy extends SceneCopy> {
  private culling = new WebglClusterCopyCulling();
  readonly transmissive: Copy[] = [];
  readonly blended: Copy[] = [];
  readonly plain: Copy[] = [];
  cull(copies: readonly Copy[], camera: HostDrawCamera) {
    this.transmissive.length = this.blended.length = this.plain.length = 0;
    if (!copies.length) return;
    this.culling.begin(camera);
    for (const copy of copies) {
      if (!this.culling.visible(copy)) continue;
      if (isTransmissive(copy.material)) this.transmissive.push(copy);
      else if (isBlended(copy.material)) this.blended.push(copy);
      else this.plain.push(copy);
    }
  }
}
