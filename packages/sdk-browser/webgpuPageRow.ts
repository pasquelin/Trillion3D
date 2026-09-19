import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { depthLayerUnits } from '../sdk-core/index.ts';
import { createPageRowConstants } from './webgpuPageRowConstants.ts';
import {
  assertVisibilityPageTriangles,
  PAGE_INFO_STRIDE,
  VIS_TRIANGLE_BITS,
  FLAG_LIT,
  FLAG_DOUBLE,
  FLAG_HAS_UV,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_MASK,
  FLAG_BACK,
  FLAG_HAS_ORM,
  FLAG_HAS_NORMAL_MAP,
} from './visibilityBuffer.ts';

export const ROW_ID_BASE_WORD = 27,
  ROW_HIZ_SLOT_WORD = 31;
/** Word that holds wrap addressing for the page's maps, one nibble each (`visibilityWrapModes.ts`).
 *  It occupies one of the row's padding words: the row does not grow by a byte. */
export const ROW_WRAP_MODES_WORD = 61;
/** Row word that carries the line's placement (`PageInfo.placement`). */
export const ROW_PLACEMENT_WORD = 62;
/** Row word that holds how many indices the page draws: what the GPU reads to draw it, and so the
 *  only vertex count an image walk needs to reread. */
export const ROW_INDEX_WORDS = 25;
/**
 * Identifier base of a page-table row: its rank shifted by the triangle bits, leaving zero free for
 * the background. The first write of a row and the compact that moves it both rest on it; two writes
 * of the same value, one formula.
 */
export const packedRowBase = (row: number) => ((row + 1) << VIS_TRIANGLE_BITS) >>> 0;
type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
};
type PageRowResources = {
  geometryBlocks: Map<THREE.BufferGeometry['attributes'], GeometryBlock>;
  mapLayer: Map<THREE.Texture, number>;
  dataLayer: Map<THREE.Texture, number>;
  markRowDirty: (row: number) => void;
};

/** Serializes one drawable cluster row after its occupant, slot, or input epoch changes. */
export function createPageRowWriter({
  geometryBlocks,
  mapLayer,
  dataLayer,
  markRowDirty,
}: PageRowResources) {
  // What the catalogue fixes once and for all is not recomputed for every arriving page.
  const constants = createPageRowConstants();
  return (
    rec: PageRec,
    pageIndex: number,
    row: number,
    offsetWords: number,
    index: Uint32Array,
    floats: Float32Array,
    ints: Uint32Array,
  ) => {
    const base = row * (PAGE_INFO_STRIDE / 4),
      material = constants.materialOf(rec.material),
      geo = geometryBlocks.get(rec.attributes);
    const mat = material.mat;
    const layer = mat.map && mapLayer.has(mat.map) ? mapLayer.get(mat.map)! : 0;
    const roughLayer =
      mat.roughnessMap && dataLayer.has(mat.roughnessMap) ? dataLayer.get(mat.roughnessMap)! : 0;
    const metalLayer =
      mat.metalnessMap && dataLayer.has(mat.metalnessMap) ? dataLayer.get(mat.metalnessMap)! : 0;
    const nrmLayer =
      mat.normalMap && dataLayer.has(mat.normalMap) ? dataLayer.get(mat.normalMap)! : 0;
    floats.set(rec.matrix.elements, base);
    floats[base + 16] = mat.baseColor[0];
    floats[base + 17] = mat.baseColor[1];
    floats[base + 18] = mat.baseColor[2];
    floats[base + 19] = mat.alphaTest > 0 ? mat.alphaTest : 1;
    floats[base + 20] = mat.metalness;
    floats[base + 21] = mat.roughness;
    let flags = 0;
    if (mat.lit) flags |= FLAG_LIT;
    if (mat.doubleSided) flags |= FLAG_DOUBLE;
    if (geo?.hasUv) flags |= FLAG_HAS_UV;
    if (layer) flags |= FLAG_HAS_MAP;
    if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL;
    if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT;
    if (mat.alphaTest > 0) flags |= FLAG_MASK;
    if (mat.backSide) flags |= FLAG_BACK;
    if (roughLayer || metalLayer) flags |= FLAG_HAS_ORM;
    if (nrmLayer) flags |= FLAG_HAS_NORMAL_MAP;
    // A page holding more triangles than the identifier's eight low bits would alias the next page.
    assertVisibilityPageTriangles(index.length / 3, rec.url);
    ints[base + 22] = layer;
    ints[base + 23] = flags;
    ints[base + 24] = offsetWords;
    ints[base + ROW_INDEX_WORDS] = index.length;
    ints[base + 26] = geo?.vertexBase ?? 0;
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(row);
    ints[base + 30] = constants.hashOf(rec.clusterId);
    // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
    // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image.
    ints[base + ROW_HIZ_SLOT_WORD] = row;
    ints[base + 32] = roughLayer;
    ints[base + 33] = metalLayer;
    ints[base + 34] = nrmLayer;
    floats[base + 35] = mat.normalScale;
    const aoLayer = mat.aoMap ? (dataLayer.get(mat.aoMap) ?? 0) : 0,
      emissiveLayer = mat.emissiveMap ? (mapLayer.get(mat.emissiveMap) ?? 0) : 0;
    ints[base + 42] = aoLayer;
    floats[base + 43] = mat.aoIntensity;
    ints[base + 46] = emissiveLayer;
    ints[base + 47] = pageIndex;
    floats.set(mat.emissive, base + 48);
    floats[base + 54] = mat.normalScaleY;
    floats[base + 55] = rec.role === 'coarse' ? 1 : 0;
    floats[base + 56] = 0;
    // Depth units to add for this cluster's coplanar layer — engine depth is reversed: zero for
    // layer 0, one calculation source for the hardware path and the software raster alike.
    ints[base + 60] = depthLayerUnits(rec.depthLayer);
    // Each map addresses its texture in its own wrap mode: colour may repeat where normals clamp,
    // and the shader reads the nibble of the map it samples.
    ints[base + ROW_WRAP_MODES_WORD] = material.wrap;
    // Row placement: the temporal pass reads the pixel motion matrix there. A page without a
    // placement does not exist in a WebGPU layout: that is an invariant, not zero.
    if (rec.placementIndex === undefined) throw new Error('PAGE_PLACEMENT_MISSING');
    ints[base + ROW_PLACEMENT_WORD] = rec.placementIndex;
    markRowDirty(row);
  };
}
