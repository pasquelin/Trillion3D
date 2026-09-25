import {
  BOX_VALUES,
  boxTransform,
  clipPlanesFromMatrix,
  FRUSTUM_PLANE_VALUES,
  frustumExcludesBox,
} from '../../../../sdk-core/src/index.ts';
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import { placementsSphere } from './meshDepth.ts';
import { readHostBox } from '../../host/boxBounds.ts';
import { isTransmissive, visMaterial } from '../../visibility/shader/material.ts';
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts';
import { firstMaterial } from '../../scene/materialSide.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';

type Centre = { x: number; y: number; z: number };
/** What the cull reads of a scene copy: its declared culling, its surface, its local bounds,
 *  its world placement — and, drawn at several placements, the placements themselves. */
type CulledCopy = {
  frustumCulled: boolean;
  material: WholeMesh['material'];
  matrixWorld: { elements: ArrayLike<number> };
  geometry: {
    boundingBox: Parameters<typeof readHostBox>[1] | null;
    computeBoundingBox(): void;
    boundingSphere?: { center: Centre; radius: number } | null;
    computeBoundingSphere?(): void;
  };
  readonly kind?: string;
  readonly instanceMatrix?: { readonly array: ArrayLike<number>; readonly version?: number };
  readonly count?: number;
};
/** A scene copy the owner draws: a host mesh drawn whole, culled as the host would. Its
 *  `material` is the HOST MESH's own field, not a page's `declaration`: a diagnostic mode
 *  repaints these meshes in place — painted glass stops transmitting — and the pass a copy
 *  belongs to is decided at the draw, on what the mesh declares at that moment. */
export type SceneCopy = WholeMesh & CulledCopy;

/**
 * Frustum test of the scene copies the owner draws, the one the host renderer would apply: a
 * copy declared `frustumCulled` is skipped when its world box leaves the frustum, unless its
 * surface is never culled (`neverCulled`). What it saves is not the copy's draw alone but the
 * backdrop pass a transmissive copy asks for.
 */
class WebglClusterCopyCulling {
  private viewProjection = new Float32Array(16);
  private planes = new Float64Array(FRUSTUM_PLANE_VALUES);
  private box = new Float64Array(BOX_VALUES);
  /** Reads the frame's frustum once; the copies are then tested against it. */
  begin(camera: HostDrawCamera) {
    multiplyMatrix4Typed(this.viewProjection, camera.projection, camera.view);
    clipPlanesFromMatrix(this.planes, this.viewProjection);
  }
  visible(copy: CulledCopy) {
    if (!copy.frustumCulled || neverCulled(visMaterial(copy.material))) return true;
    const box = this.box;
    if (copy.kind === 'instancedMesh' && copy.instanceMatrix) this.placementsBox(copy);
    else {
      if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox();
      readHostBox(box, copy.geometry.boundingBox!);
    }
    boxTransform(box, 0, box, 0, copy.matrixWorld.elements);
    return !frustumExcludesBox(this.planes, box[0], box[1], box[2], box[3], box[4], box[5]);
  }
  /** The box around the union of the placements' spheres — the sphere the depth sorts on —
   *  never the geometry's box alone, which a placement carries elsewhere. */
  private placementsBox(copy: CulledCopy) {
    const geometry = copy.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere?.();
    const { centre: c, radius: r } = placementsSphere(copy, geometry.boundingSphere!);
    this.box.set([c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r]);
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
