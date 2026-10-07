// Pure A2 oracles, no side effects: the CPU image's tests import them as reference
// (`cpu-image/shade.test.ts`).
import * as THREE from 'three'
import type { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts'
import { threeCamera } from '../../witnesses/three/fromGraphNodes.ts'
import { RASTER_BACKGROUND } from '../../../packages/sdk-browser/src/page/raster.ts'
import { linearToSrgb8 } from '../../../packages/sdk-core/src/math/primitives/color.ts'
import { perspectiveBary, triangleAt } from '../../../packages/sdk-browser/src/visibility/math.ts'
import { attr2, backgroundRgb, barycentric, sampleLinear, sampleMap } from './cpu-image/math.ts'
import { shadeLit } from './cpu-image/lighting.ts'
import { type VisPage } from '../../../packages/sdk-browser/src/visibility/types.ts'
import {
  createEngineCamera,
  readCameraWorld,
  type EngineCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts'
import type { DepthCamera } from '../../../packages/sdk-browser/src/camera/depthConvention.ts'
import type { MatrixElements } from '../../../packages/sdk-browser/src/math/matrixElements.ts'
import { unpackVisibilityId } from './cpu-image/ids.ts'

/** A page with the world of its root, which the oracle reads on the page. */
type Placed = VisPage & { matrix: MatrixElements }

/** The oracle compares per-frame caching, not the camera read: it copies the host
 *  camera as the frame input does, and shading reads the same. */
const engineScratch = createEngineCamera()

/** `bench/oracles/browser/cpu-image/shadePixel.ts:15-63`: the surface record and the triangle per pixel. */
function referenceShadePixel(
  id: number,
  pages: readonly (Placed | undefined)[],
  cam: EngineCamera,
  depthCam: DepthCamera,
  width: number,
  height: number,
  x: number,
  y: number,
  background: number,
) {
  const unpacked = unpackVisibilityId(id)
  if (!unpacked) return backgroundRgb(background)
  const page = pages[unpacked.pageIndex]
  if (!page) return backgroundRgb(background)
  const tri = triangleAt(page, page.matrix, unpacked.triangleIndex, depthCam, width, height)
  if (!tri) return backgroundRgb(background)
  const affine = barycentric(tri.a, tri.b, tri.c, x, y)
  if (!affine) return backgroundRgb(background)
  const bary = perspectiveBary(tri.a, tri.b, tri.c, affine)
  const uv = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, bary.w0, bary.w1, bary.w2)
  const mat = page.material
  let rgb: [number, number, number] = [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]]
  if (mat.map) {
    const sample = sampleMap(mat.map, uv[0], uv[1])
    rgb = [rgb[0] * sample[0], rgb[1] * sample[1], rgb[2] * sample[2]]
  }
  let metalness = mat.metalness,
    roughness = mat.roughness
  if (mat.metalnessMap)
    metalness = Math.min(
      1,
      Math.max(0, metalness * sampleLinear(mat.metalnessMap, uv[0], uv[1])[2]),
    )
  if (mat.roughnessMap)
    roughness = Math.min(
      1,
      Math.max(0, roughness * sampleLinear(mat.roughnessMap, uv[0], uv[1])[1]),
    )
  const encode = (c: [number, number, number]) =>
    mat.map || mat.lit
      ? [linearToSrgb8(c[0]), linearToSrgb8(c[1]), linearToSrgb8(c[2])]
      : [
          Math.max(0, Math.min(255, c[0] * 255)) | 0,
          Math.max(0, Math.min(255, c[1] * 255)) | 0,
          Math.max(0, Math.min(255, c[2] * 255)) | 0,
        ]
  if (mat.lit) rgb = shadeLit(page, tri, affine, bary, uv, mat, rgb, metalness, roughness, cam)
  return encode(rgb)
}

/** `bench/oracles/browser/cpu-image/shade.ts:8-34`. */
export function referenceShadeVisibility(
  ids: Uint32Array,
  pages: readonly (Placed | undefined)[],
  cam: Camera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const eye = threeCamera(cam) as THREE.PerspectiveCamera
  const [width, height] = viewport,
    pixels = new Uint8Array(width * height * 4)
  const engine = readCameraWorld(engineScratch, cam)
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    eye.projectionMatrix,
    eye.matrixWorldInverse,
  )
  // The oracle keeps its view-projection from the host library; the depth convention
  // comes from the engine camera, which read it on the host camera. `DepthCamera` reads a
  // `Float64Array` specifically, so the matrix elements are copied rather than shared.
  const viewProjFlat = new Float64Array(16)
  viewProjFlat.set(viewProj.elements)
  const depthCam: DepthCamera = { viewProjection: viewProjFlat }
  const bg = backgroundRgb(background)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * width + x,
        rgb = referenceShadePixel(ids[o], pages, engine, depthCam, width, height, x, y, background)
      const p = o * 4
      pixels[p] = rgb[0] ?? bg[0]
      pixels[p + 1] = rgb[1] ?? bg[1]
      pixels[p + 2] = rgb[2] ?? bg[2]
      pixels[p + 3] = 255
    }
  return pixels
}
