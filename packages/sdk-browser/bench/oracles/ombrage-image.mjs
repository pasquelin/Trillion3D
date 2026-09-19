// Pure A2 oracles, no side effects: `ombrage.bench.mjs` measures them; unit tests import
// them as reference.
import * as THREE from 'three';
import { RASTER_BACKGROUND } from '../../pageRaster.ts';
import {
  attr2,
  backgroundRgb,
  barycentric,
  linearToSrgb8,
  perspectiveBary,
  sampleLinear,
  sampleMap,
  triangleAt,
} from '../../visibilityMath.ts';
import { shadeLit } from '../../visibilityLighting.ts';
import { unpackVisibilityId, visMaterial } from '../../visibilityTypes.ts';
import { createEngineCamera, readCameraWorld } from '../../cameraWorld.ts';

/** The oracle compares per-frame caching, not the camera read: it copies the host
 *  camera as the frame input does, and shading reads the same. */
const engineScratch = createEngineCamera();

/** `visibilityShadePixel.ts:15-63` before batch A: `visMaterial` and the triangle per pixel. */
function referenceShadePixel(id, pages, cam, depthCam, width, height, x, y, background) {
  const unpacked = unpackVisibilityId(id);
  if (!unpacked) return backgroundRgb(background);
  const page = pages[unpacked.pageIndex];
  if (!page) return backgroundRgb(background);
  const tri = triangleAt(page, unpacked.triangleIndex, depthCam, width, height);
  if (!tri) return backgroundRgb(background);
  const affine = barycentric(tri.a, tri.b, tri.c, x, y);
  if (!affine) return backgroundRgb(background);
  const bary = perspectiveBary(tri.a, tri.b, tri.c, affine);
  const uv = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, bary.w0, bary.w1, bary.w2);
  const mat = visMaterial(page.material);
  let rgb = [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]];
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
  const encode = (c) =>
    mat.map || mat.lit
      ? [linearToSrgb8(c[0]), linearToSrgb8(c[1]), linearToSrgb8(c[2])]
      : [
          Math.max(0, Math.min(255, c[0] * 255)) | 0,
          Math.max(0, Math.min(255, c[1] * 255)) | 0,
          Math.max(0, Math.min(255, c[2] * 255)) | 0,
        ];
  if (mat.lit) rgb = shadeLit(page, tri, affine, bary, uv, mat, rgb, metalness, roughness, cam);
  return encode(rgb);
}

/** `visibilityShade.ts:8-34` before batch A. */
export function referenceShadeVisibility(
  ids,
  pages,
  cam,
  viewport,
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport,
    pixels = new Uint8Array(width * height * 4);
  const engine = readCameraWorld(engineScratch, cam);
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  // The oracle keeps its view-projection from the host library; the depth convention
  // comes from the engine camera, which read it on the host camera.
  const depthCam = { viewProjection: viewProj.elements };
  const bg = backgroundRgb(background);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * width + x,
        rgb = referenceShadePixel(ids[o], pages, engine, depthCam, width, height, x, y, background);
      const p = o * 4;
      pixels[p] = rgb[0] ?? bg[0];
      pixels[p + 1] = rgb[1] ?? bg[1];
      pixels[p + 2] = rgb[2] ?? bg[2];
      pixels[p + 3] = 255;
    }
  return pixels;
}
