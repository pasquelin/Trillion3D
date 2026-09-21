import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import type { BatchPage, DrawRanges } from './clusterBatchRange.ts';
import type { ClusterDraw } from './clusterBatches.ts';
import { firstMaterial, sideOf, type Side } from './materialSide.ts';

/** Vertex attributes of a host geometry, as the page records carry them. */
export type HostAttributes = BatchPage['attributes'];
/** A host material, or the array a multi-material mesh declares — refused before any draw. */
export type HostMaterial = BatchPage['material'];
/** Bytes the engine uploads to one GPU buffer: `version` names the state last uploaded, and
 *  `updateRanges` what changed within the same bytes since — sent alone, then cleared. */
export type GpuBuffer = {
  array: ArrayLike<number> & ArrayBufferView & { BYTES_PER_ELEMENT: number };
  version: number;
  updateRanges: readonly { start: number; count: number }[];
  clearUpdateRanges(): void;
};
type IndexBuffer = GpuBuffer & { count: number };
export type VertexAttribute = GpuBuffer & { itemSize: number; normalized: boolean };
/** Geometry of a batch record: the engine's resident index over the host's vertex attributes. */
export type ClusterGeometry = { index: IndexBuffer; attributes: HostAttributes };
/** A host mesh the owner draws whole — a page of a diagnostic mode, a scene copy — read by
 *  shape: its geometry, its material and the placement the engine wrote for it. */
export type WholeMesh = {
  geometry: { index: IndexBuffer | null; attributes: HostAttributes };
  material: HostMaterial;
  matrix: { elements: ArrayLike<number> };
};

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
    yield [0, draw.geometry.index?.count ?? draw.geometry.attributes.position.count];
    return;
  }
  for (let range = 0; range < draw._multiDrawCount; range++)
    yield [
      draw._multiDrawStarts[range] / Uint32Array.BYTES_PER_ELEMENT,
      draw._multiDrawCounts[range],
    ];
}
/** Triangles a whole page mesh submits, indexed or not. */
export const wholeMeshTriangles = (mesh: WholeMesh) =>
  (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;

const BACK_THEN_FRONT: readonly Side[] = ['back', 'front'];
const DECLARED_SIDE: readonly undefined[] = [undefined];
/**
 * The passes a material draws, read at the draw as the reference reads them: a two-sided
 * transparent surface draws its back faces then its front faces, in that order; any other
 * surface draws once, on the faces its material declares (`undefined`).
 */
export function drawPasses(material: HostMaterial): readonly (Side | undefined)[] {
  const single = firstMaterial(material);
  return single?.transparent && sideOf(single) === 'double' && !single.forceSinglePass
    ? BACK_THEN_FRONT
    : DECLARED_SIDE;
}

/**
 * Draw record of a group: the primitive's resident index, the host material of its pass, the
 * instance placement and the index ranges of the visible clusters, submitted in one
 * `WEBGL_multi_draw` by the owner (or its loop fallback). No host mesh: nothing here is drawn
 * by anything but the engine's program.
 */
export class ClusterDrawMesh {
  geometry: ClusterGeometry;
  material: HostMaterial;
  /** Source rank of the instance this record draws. */
  renderOrder: number;
  /** World placement of the instance, in double precision like the host matrices it copies. */
  matrix = { elements: new Float64Array(IDENTITY_MATRIX4) };
  /** Depth offset of the coplanar layer this record draws, in hardware units: set on the twin
   *  batch of a layer above 0, `undefined` on the layer-0 batch, whose material's own offset
   *  applies. */
  polygonOffsetUnits: number | undefined;
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount = 0;
  constructor(
    geometry: ClusterGeometry,
    material: HostMaterial,
    ranges: DrawRanges,
    renderOrder: number,
    polygonOffsetUnits?: number,
  ) {
    this.geometry = geometry;
    this.material = material;
    this.renderOrder = renderOrder;
    this.polygonOffsetUnits = polygonOffsetUnits;
    this._multiDrawStarts = ranges.starts;
    this._multiDrawCounts = ranges.counts;
  }
}
