import * as THREE from 'three';
import {
  attr2,
  barycentric,
  linearToSrgb8,
  perspectiveBary,
  sampleLinear,
  sampleMap,
} from './visibilityMath.ts';
import { shadeLit } from './visibilityLighting.ts';
import type { VisibilityFrame } from './visibilityFrame.ts';

type Rgb = [number, number, number];

/** 8 bits par canal : sRGB pour ce qui est texturé ou éclairé, échelle directe sinon. */
function encode(c: Rgb, srgb: boolean): Rgb {
  return srgb
    ? [linearToSrgb8(c[0]), linearToSrgb8(c[1]), linearToSrgb8(c[2])]
    : [
        Math.max(0, Math.min(255, c[0] * 255)) | 0,
        Math.max(0, Math.min(255, c[1] * 255)) | 0,
        Math.max(0, Math.min(255, c[2] * 255)) | 0,
      ];
}

/** La couleur d'un pixel. Le triangle projeté et le matériau viennent de `frame`, qui les calcule
 *  une fois par image : le pixel ne reprojette rien et n'alloue aucune description de matériau. */
export function shadePixel(
  frame: VisibilityFrame,
  id: number,
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  fond: Rgb,
): Rgb {
  const tri = frame.triangle(id);
  if (!tri) return fond;
  const affine = barycentric(tri.a, tri.b, tri.c, x, y);
  if (!affine) return fond;
  const page = tri.page;
  const bary = perspectiveBary(tri.a, tri.b, tri.c, affine);
  const uv = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, bary.w0, bary.w1, bary.w2);
  const mat = frame.material(page);
  let rgb: Rgb = [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]];
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
  if (mat.lit) rgb = shadeLit(page, tri, affine, bary, uv, mat, rgb, metalness, roughness, camera);
  return encode(rgb, !!mat.map || mat.lit);
}
