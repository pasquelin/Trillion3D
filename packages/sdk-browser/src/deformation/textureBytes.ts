import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import type { GeometryPageDescriptor } from '../../../sdk-core/src/page/contracts.ts';
import { skinStreams } from '../../../sdk-core/src/world/geometry/skin.ts';
import { FLAG_SKIN, FLAG_MORPH } from '../cluster/format.ts';

/** Width shared with the texel-addressing shader; RGBA32F occupies sixteen bytes per texel. */
export const DEFORMATION_ROW_TEXELS = 1024;
export const deformationTextureBytes = (texels: number) =>
  Math.ceil(texels / DEFORMATION_ROW_TEXELS) * DEFORMATION_ROW_TEXELS * 16;

export function morphTargets(geometry: Geometry) {
  const morph = geometry.attributes.morph,
    vertices = geometry.attributes.position?.count ?? 0;
  return morph && vertices
    ? morph.array.length / (6 * vertices)
    : (geometry.morphAttributes?.position?.length ?? 0);
}

/** Exact padded source allocation, reserved with geometry admission and released with it. */
export function geometryDeformationBytes(geometry: Geometry) {
  const count = geometry.attributes.position?.count ?? 0;
  return deformationTextureBytes(
    count * (skinStreams(geometry).width + morphTargets(geometry) * 2),
  );
}

/** Before decode, the descriptor bounds every influence and target by its decoded bytes.
 * Skin pairs expand from two floats to four; morph vectors expand from three to four.
 * Two times all decoded bytes is therefore conservative, including every possible stream. */
export function pageDeformationBytes(page: GeometryPageDescriptor) {
  return page.flags & (FLAG_SKIN | FLAG_MORPH)
    ? deformationTextureBytes((page.uncompressedBytes * 2) / 16)
    : 0;
}
