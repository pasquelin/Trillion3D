import * as THREE from 'three';
import {
  attr2,
  backgroundRgb,
  barycentric,
  linearToSrgb8,
  perspectiveBary,
  sampleLinear,
  sampleMap,
  triangleAt,
} from './visibilityMath.ts';
import { shadeLit } from './visibilityLighting.ts';
import { unpackVisibilityId, visMaterial, type VisPage } from './visibilityTypes.ts';

export function shadePixel(
  id: number,
  pages: VisPage[],
  camera: THREE.PerspectiveCamera,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
  x: number,
  y: number,
  background: number,
): [number, number, number] {
  const unpacked = unpackVisibilityId(id);
  if (!unpacked) return backgroundRgb(background) as [number, number, number];
  const page = pages[unpacked.pageIndex];
  if (!page) return backgroundRgb(background) as [number, number, number];
  const tri = triangleAt(page, unpacked.triangleIndex, viewProj, width, height);
  if (!tri) return backgroundRgb(background) as [number, number, number];
  const affine = barycentric(tri.a, tri.b, tri.c, x, y);
  if (!affine) return backgroundRgb(background) as [number, number, number];
  const bary = perspectiveBary(tri.a, tri.b, tri.c, affine);
  const uv = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, bary.w0, bary.w1, bary.w2);
  const mat = visMaterial(page.material);
  let rgb: [number, number, number] = [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]];
  if (mat.map) {
    const sample = sampleMap(mat.map, uv[0], uv[1]);
    rgb = [rgb[0] * sample[0], rgb[1] * sample[1], rgb[2] * sample[2]];
  }
  let metalness = mat.metalness,
    roughness = mat.roughness;
  if (mat.metalnessMap)
    metalness = Math.min(
      1,
      Math.max(0, metalness * sampleLinear(mat.metalnessMap, uv[0], uv[1])[2]),
    );
  if (mat.roughnessMap)
    roughness = Math.min(
      1,
      Math.max(0, roughness * sampleLinear(mat.roughnessMap, uv[0], uv[1])[1]),
    );
  const encode = (c: [number, number, number]): [number, number, number] =>
    mat.map || mat.lit
      ? [linearToSrgb8(c[0]), linearToSrgb8(c[1]), linearToSrgb8(c[2])]
      : [
          Math.max(0, Math.min(255, c[0] * 255)) | 0,
          Math.max(0, Math.min(255, c[1] * 255)) | 0,
          Math.max(0, Math.min(255, c[2] * 255)) | 0,
        ];
  if (mat.lit) rgb = shadeLit(page, tri, affine, bary, uv, mat, rgb, metalness, roughness, camera);
  return encode(rgb);
}
