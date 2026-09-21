import * as THREE from 'three';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import type { DrawRanges } from './clusterBatchRange.ts';
import type { ClusterDraw } from './clusterBatches.ts';

/** A backend whose paged clusters the engine's program draws publishes its submissions here.
 *  The raster oracle and the tests read them; a host never does, so the public backend
 *  contract does not carry it. */
interface ClusterDrawSource {
  clusterDraws(): readonly ClusterDraw[];
}
/** The draw records a backend submits for the cut; none from one that owns no cluster. */
export function submittedDraws(backend: object): readonly ClusterDraw[] {
  return (backend as Partial<ClusterDrawSource>).clusterDraws?.() ?? [];
}
/** A batch record, as opposed to the whole page mesh of a diagnostic mode. */
export const isClusterDrawMesh = (draw: ClusterDraw): draw is ClusterDrawMesh =>
  '_multiDrawCount' in draw;
/** Index ranges a submission draws: those of a batch record, the whole index — or the whole
 *  vertex list, a wireframe page being non-indexed — of a page mesh. */
export function* drawnRanges(draw: ClusterDraw): Generator<[number, number]> {
  if (!isClusterDrawMesh(draw)) {
    yield [0, draw.geometry.getIndex()?.count ?? draw.geometry.getAttribute('position').count];
    return;
  }
  for (let range = 0; range < draw._multiDrawCount; range++)
    yield [
      draw._multiDrawStarts[range] / Uint32Array.BYTES_PER_ELEMENT,
      draw._multiDrawCounts[range],
    ];
}
/** Triangles a whole page mesh submits, indexed or not. */
export const wholeMeshTriangles = (mesh: THREE.Mesh) =>
  (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;

/**
 * Draw record of a group: the primitive's shared geometry, the material of its pass, the
 * instance placement and the index ranges of the visible clusters, submitted in one
 * `WEBGL_multi_draw` by the owner (or its loop fallback). No host mesh: nothing here is drawn
 * by anything but the engine's program.
 */
export class ClusterDrawMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Source rank of the instance this record draws. */
  renderOrder: number;
  /** World placement of the instance, in double precision like the host matrices it copies. */
  matrix = { elements: new Float64Array(IDENTITY_MATRIX4) };
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount = 0;
  /** Exact back/front pair created by `sideSplit`; arbitrary material arrays remain unsupported. */
  _sideSplitMaterials: [THREE.Material, THREE.Material] | undefined;
  _sideSplitBack: THREE.Material | undefined;
  _sideSplitFront: THREE.Material | undefined;
  _sideSplitSource: THREE.Material | undefined;
  _sideSplitPolygonMaterials: [THREE.Material, THREE.Material] | undefined;
  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    ranges: DrawRanges,
    renderOrder: number,
  ) {
    this.geometry = geometry;
    this.material = material;
    this.renderOrder = renderOrder;
    this._multiDrawStarts = ranges.starts;
    this._multiDrawCounts = ranges.counts;
    this._sideSplitMaterials = undefined;
    this._sideSplitBack = undefined;
    this._sideSplitFront = undefined;
    this._sideSplitSource = undefined;
    this._sideSplitPolygonMaterials = undefined;
  }
}

/**
 * A two-sided transparent material draws in two passes, back faces then front faces, as the
 * reference renderer orders them. The two passes are frozen as two materials so the owner
 * submits them in that order without touching `side` on the source material.
 */
export function sideSplit(
  material: THREE.Material | THREE.Material[],
): [THREE.Material, THREE.Material] | undefined {
  if (Array.isArray(material)) return undefined;
  if (
    material.transparent !== true ||
    material.side !== THREE.DoubleSide ||
    material.forceSinglePass === true
  )
    return undefined;
  const back = material.clone(),
    front = material.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  return [back, front];
}
