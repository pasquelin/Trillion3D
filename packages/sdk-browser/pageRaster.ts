import { multiplyMatrix4 } from '../sdk-core/index.ts';
import type {
  HostAttribute,
  HostAttributes,
  HostColour,
  HostMaterials,
  HostNode,
} from './hostResources.ts';
import { firstMaterial } from './materialSide.ts';
import { copyElements, type MatrixElements } from './matrixElements.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { PageRec } from './pageSelection.ts';
import type { PageSurface } from './pageSurface.ts';
import { barycentricAt, signedArea } from './visibilityProjection.ts';
import { resolveCameraWorld, type HostCamera } from './cameraWorld.ts';
import { drawnRanges, submittedDraws } from './clusterBatchMesh.ts';

export const RASTER_BACKGROUND = 0x171d28;
const BACKGROUND = RASTER_BACKGROUND;

/** A mesh of the host graph as the oracle reads it: what it draws, and where it stands. */
type HostRasterMesh = {
  readonly isMesh?: boolean;
  readonly geometry: { readonly index: HostAttribute | null; readonly attributes: HostAttributes };
  readonly material: HostMaterials;
  readonly matrixWorld: MatrixElements;
};

/** Opaque image used before the first WebGPU readback and after every resize. */
export function opaqueBackgroundRgba(
  width: number,
  height: number,
  background = RASTER_BACKGROUND,
) {
  const pixels = new Uint8Array(width * height * 4);
  const red = (background >> 16) & 255,
    green = (background >> 8) & 255,
    blue = background & 255;
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return pixels;
}

const byteRgb = (r: number, g: number, b: number) => [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
const WHITE: HostColour = { r: 1, g: 1, b: 1 };

/** The eight-bit colour a host material declares; a surface that declares none draws white. */
function colorOf(declared: HostMaterials) {
  const first = firstMaterial(declared) as { color?: HostColour & { isColor?: boolean } } | undefined;
  const color = first?.color?.isColor ? first.color : WHITE;
  return byteRgb(color.r, color.g, color.b);
}

/** The same eight-bit colour, from a surface record the page already carries. */
function surfaceColorOf(surface: PageSurface) {
  const base = surface.baseColor;
  return byteRgb(base[0], base[1], base[2]);
}

/** CPU raster of what a backend draws: its owned draw records, then the plain meshes of its
 *  scene. Used as an oracle; not a GPU timestamp. */
export function rasterPageRecords(
  backend: Pick<RenderBackend, 'scene'>,
  camera: HostCamera,
  size: [number, number],
) {
  const [width, height] = size,
    pixels = opaqueBackgroundRgba(width, height, BACKGROUND);
  const viewProj = cameraViewProjection(camera);
  // A batch record submits only its ranges: the oracle follows the same cut, not the whole buffer.
  for (const draw of submittedDraws(backend)) {
    const index = draw.geometry.index,
      position = draw.geometry.attributes.position,
      world = draw.matrix.elements,
      rgb = colorOf(draw.material),
      vertex = (i: number) => (index ? index.array[i] : i);
    for (const [first, length] of drawnRanges(draw))
      for (let i = first; i < first + length; i += 3) {
        project(world, position, vertex(i), viewProj, width, height, pa);
        project(world, position, vertex(i + 1), viewProj, width, height, pb);
        project(world, position, vertex(i + 2), viewProj, width, height, pc);
        fillTriangle(pixels, width, height, pa, pb, pc, rgb);
      }
  }
  const meshes: HostRasterMesh[] = [];
  backend.scene.traverse((node: HostNode) => {
    const mesh = node as unknown as HostRasterMesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const { index, attributes } = mesh.geometry,
      position = attributes.position;
    if (!position) continue;
    const world = mesh.matrixWorld.elements,
      rgb = colorOf(mesh.material),
      count = index ? index.count : position.count,
      vertex = (i: number) => (index ? index.getX(i) : i);
    for (let i = 0; i < count; i += 3) {
      project(world, position, vertex(i), viewProj, width, height, pa);
      project(world, position, vertex(i + 1), viewProj, width, height, pb);
      project(world, position, vertex(i + 2), viewProj, width, height, pc);
      fillTriangle(pixels, width, height, pa, pb, pc, rgb);
    }
  }
  return pixels;
}

/** CPU raster of cluster page records (the triangles the WebGPU path pulls). Same fill rule as rasterPageRecords. */
export function rasterPages(
  pages: Array<Pick<PageRec, 'array' | 'attributes' | 'matrix' | 'material'>>,
  camera: HostCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport,
    pixels = opaqueBackgroundRgba(width, height, background);
  const viewProj = cameraViewProjection(camera);
  for (const page of pages) {
    const position = page.attributes.position,
      index = page.array;
    if (!position || !index) continue;
    const rgb = surfaceColorOf(page.material),
      world = page.matrix.elements;
    for (let i = 0; i < index.length; i += 3) {
      project(world, position, index[i], viewProj, width, height, pa);
      project(world, position, index[i + 1], viewProj, width, height, pb);
      project(world, position, index[i + 2], viewProj, width, height, pc);
      fillTriangle(pixels, width, height, pa, pb, pc, rgb);
    }
  }
  return pixels;
}

const projection = new Float64Array(16),
  view = new Float64Array(16),
  viewProjection = new Float64Array(16);
/** Clip matrix of the drawn view, as the host composed it: its own projection, finite far plane
 *  included, times the inverse of the world pose the contract resolves. */
function cameraViewProjection(camera: HostCamera) {
  // Callable function alone: it resolves its own pose (contract: `cameraWorld.ts`).
  resolveCameraWorld(camera);
  copyElements(projection, camera.projectionMatrix.elements);
  copyElements(view, camera.matrixWorldInverse.elements);
  multiplyMatrix4(viewProjection, projection, view);
  return viewProjection;
}

const local = new Float64Array(3),
  clip = new Float64Array(3);
const pa = { x: 0, y: 0 },
  pb = { x: 0, y: 0 },
  pc = { x: 0, y: 0 };
/**
 * `out = M · (x, y, z, 1)`, divided through. The reciprocal is taken once and multiplied in,
 * term for term as the reference library does it: a division per component would round
 * elsewhere, and an oracle compared pixel for pixel reads that rounding on a silhouette.
 */
function apply(out: Float64Array, m: ArrayLike<number>, x: number, y: number, z: number) {
  const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
}
function project(
  world: ArrayLike<number>,
  position: HostAttribute,
  vi: number,
  viewProj: Float64Array,
  width: number,
  height: number,
  out: { x: number; y: number },
) {
  apply(local, world, position.getX(vi), position.getY(vi), position.getZ(vi));
  apply(clip, viewProj, local[0], local[1], local[2]);
  out.x = (clip[0] * 0.5 + 0.5) * width;
  out.y = (1 - (clip[1] * 0.5 + 0.5)) * height;
}

function fillTriangle(
  pixels: Uint8Array,
  width: number,
  height: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  rgb: number[],
) {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
    maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const area = signedArea(a, b, c);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const o = (y * width + x) * 4;
      pixels[o] = rgb[0];
      pixels[o + 1] = rgb[1];
      pixels[o + 2] = rgb[2];
      pixels[o + 3] = 255;
    }
}
