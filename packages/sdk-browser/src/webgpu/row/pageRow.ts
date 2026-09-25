import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { depthLayerUnits } from '../../../../sdk-core/src/index.ts';
import { createPageRowConstants } from './pageRowConstants.ts';
import {
  emptyGeometryBlock,
  rowGeometry,
  rowMaterial,
  type GeometryBlock,
  type MaterialLayers,
} from './pageRowMaterial.ts';
import {
  assertVisibilityPageTriangles,
  PAGE_INFO_STRIDE,
  VIS_TRIANGLE_BITS,
} from '../../visibility/buffer.ts';

export const ROW_ID_BASE_WORD = 27,
  ROW_HIZ_SLOT_WORD = 31;
/** Row words of the colour map's atlas slot and of the material flags: what the shadow pass
 *  reads to cut a masked material, and so what a colour tile's arrival is matched against. */
export const ROW_MAP_LAYER_WORD = 22,
  ROW_FLAGS_WORD = 23;
/** Row word of the width a line page's quads widen to (`PageInfo.lineWidth`); zero for triangles. */
export const ROW_LINE_WIDTH_WORD = 61;
/** Row words of a dashed line's dash and gap (`PageInfo.dash`, `lineDash`); zero on any other row. */
export const ROW_DASH_WORD = 28;
/** Row word that carries the line's placement (`PageInfo.placement`). */
export const ROW_PLACEMENT_WORD = 62;
/** Row word that carries the resolve class key (`PageInfo.materialClass`, `../../visibility/shader/materialClass.ts`). */
export const ROW_MATERIAL_CLASS_WORD = 63;
/** Row word that holds how many indices the page draws: what the GPU reads to draw it, and so the
 *  only vertex count an image walk needs to reread. */
export const ROW_INDEX_WORDS = 25;
/**
 * Identifier base of a page-table row: its rank shifted by the triangle bits, leaving zero free for
 * the background. The first write of a row and the compact that moves it both rest on it; two writes
 * of the same value, one formula.
 */
export const packedRowBase = (row: number) => ((row + 1) << VIS_TRIANGLE_BITS) >>> 0;
/** A cluster holds the geometry a row draws: its own quantized page, or the float buffer its
 *  primitive was uploaded into. Without either, the cluster takes no row. */
export const rowHasGeometry = (rec: PageRec, position: GPUBuffer | undefined) =>
  !!rec.geometryPage || !!position;
/** Corners the row draws: the count the cluster's own geometry page declares, or the length of the
 *  index page for a cluster that still draws from one. A paged cluster never holds an index page —
 *  nothing fetches it — and this is the only number the row ever wanted from it. */
const rowIndexCount = (rec: PageRec) => rec.geometryPage?.indexCount ?? rec.array?.length ?? 0;
type PageRowResources = MaterialLayers & {
  geometryBlocks: Map<HostAttributes, GeometryBlock>;
  markRowDirty: (row: number) => void;
};

/** Serializes one drawable cluster row after its occupant, slot, or input epoch changes. */
export function createPageRowWriter(resources: PageRowResources) {
  const { geometryBlocks, markRowDirty } = resources;
  // What the catalogue fixes once and for all is not recomputed for every arriving page.
  const constants = createPageRowConstants();
  // Filled again at every row write, never allocated again.
  const block = emptyGeometryBlock();
  return (
    rec: PageRec,
    pageIndex: number,
    row: number,
    offsetWords: number,
    floats: Float32Array,
    ints: Uint32Array,
  ) => {
    const indexCount = rowIndexCount(rec);
    const base = row * (PAGE_INFO_STRIDE / 4),
      material = constants.materialOf(rec.material),
      geo = rowGeometry(rec, geometryBlocks, block);
    const mat = material.mat,
      maps = rowMaterial(mat, geo, resources);
    floats.set(rec.matrix.elements, base);
    floats[base + 16] = mat.baseColor[0];
    floats[base + 17] = mat.baseColor[1];
    floats[base + 18] = mat.baseColor[2];
    // The cutout's threshold (`maskKeep`): a dashed line without an alpha test cuts its gaps alone.
    floats[base + 19] = mat.alphaTest > 0 ? mat.alphaTest : mat.dashSize !== undefined ? 0 : 1;
    floats[base + 20] = mat.metalness;
    floats[base + 21] = mat.roughness;
    // A page holding more triangles than the identifier's eight low bits would alias the next page.
    assertVisibilityPageTriangles(indexCount / 3, rec.url);
    ints[base + ROW_MAP_LAYER_WORD] = maps.map;
    ints[base + ROW_FLAGS_WORD] = maps.flags;
    ints[base + 24] = offsetWords;
    ints[base + ROW_INDEX_WORDS] = indexCount;
    ints[base + 26] = geo?.vertexBase ?? 0;
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(row);
    // A dashed line's dash and gap (`PageInfo.dash`), zero on every other row.
    floats[base + ROW_DASH_WORD] = mat.dashSize ?? 0;
    floats[base + ROW_DASH_WORD + 1] = mat.gapSize ?? 0;
    ints[base + 30] = constants.hashOf(rec.clusterId);
    // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
    // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image.
    ints[base + ROW_HIZ_SLOT_WORD] = row;
    ints[base + 32] = maps.rough;
    ints[base + 33] = maps.metal;
    ints[base + 34] = maps.normal;
    floats[base + 35] = mat.normalScale;
    ints[base + 42] = maps.ao;
    floats[base + 43] = mat.aoIntensity;
    ints[base + 46] = maps.emissive;
    ints[base + 47] = pageIndex;
    floats.set(mat.emissive, base + 48);
    floats[base + 54] = mat.normalScaleY;
    floats[base + 55] = rec.role === 'coarse' ? 1 : 0;
    floats[base + 56] = 0;
    // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
    // layer 0, one calculation source for the hardware path and the software raster alike.
    ints[base + 60] = depthLayerUnits(rec.depthLayer);
    floats[base + ROW_LINE_WIDTH_WORD] = mat.lineWidth ?? 0;
    // Row placement: the temporal pass reads the pixel motion matrix there. A page without a
    // placement does not exist in a WebGPU layout: that is an invariant, not zero.
    if (rec.placementIndex === undefined) throw new Error('PAGE_PLACEMENT_MISSING');
    ints[base + ROW_PLACEMENT_WORD] = rec.placementIndex;
    // The class the resolve draws this page under: its flags and map slots, as one word.
    ints[base + ROW_MATERIAL_CLASS_WORD] = maps.classKey;
    markRowDirty(row);
  };
}
