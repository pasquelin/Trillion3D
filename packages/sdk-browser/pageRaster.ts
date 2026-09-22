import * as THREE from 'three';
import { asHostLibrary, type HostMaterials } from './hostResources.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { PageRec } from './pageSelection.ts';
import type { PageSurface } from './pageSurface.ts';
import { barycentricAt, signedArea } from './visibilityProjection.ts';
import { resolveCameraWorld } from './cameraWorld.ts';
import { drawnRanges, submittedDraws } from './clusterBatchMesh.ts';

export const RASTER_BACKGROUND = 0x171d28;
const BACKGROUND = RASTER_BACKGROUND;

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

function colorOf(declared: HostMaterials) {
  const material = asHostLibrary<THREE.Material | THREE.Material[]>(declared);
  const first = Array.isArray(material) ? material[0] : material;
  const color =
    'color' in first && first.color instanceof THREE.Color
      ? first.color
      : new THREE.Color(0xffffff);
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
  camera: THREE.PerspectiveCamera,
  size: [number, number],
) {
  const [width, height] = size,
    pixels = opaqueBackgroundRgba(width, height, BACKGROUND);
  // Callable function alone: it resolves its own pose (contract: `cameraWorld.ts`).
  resolveCameraWorld(camera);
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const world = new THREE.Matrix4();
  // A batch record submits only its ranges: the oracle follows the same cut, not the whole buffer.
  for (const draw of submittedDraws(backend)) {
    const index = draw.geometry.index,
      position = asHostLibrary<THREE.BufferAttribute>(draw.geometry.attributes.position),
      rgb = colorOf(draw.material),
      vertex = (i: number) => (index ? index.array[i] : i);
    world.fromArray(draw.matrix.elements);
    for (const [first, length] of drawnRanges(draw))
      for (let i = first; i < first + length; i += 3) {
        projectAttribute(world, position, vertex(i), viewProj, width, height, pa);
        projectAttribute(world, position, vertex(i + 1), viewProj, width, height, pb);
        projectAttribute(world, position, vertex(i + 2), viewProj, width, height, pc);
        fillTriangle(pixels, width, height, pa, pb, pc, rgb);
      }
  }
  const meshes: THREE.Mesh[] = [];
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry,
      index = geometry.getIndex(),
      position = geometry.getAttribute('position');
    if (!position) continue;
    const rgb = colorOf(mesh.material);
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      project(mesh, position, index, i, viewProj, width, height, pa);
      project(mesh, position, index, i + 1, viewProj, width, height, pb);
      project(mesh, position, index, i + 2, viewProj, width, height, pc);
      fillTriangle(pixels, width, height, pa, pb, pc, rgb);
    }
  }
  return pixels;
}

/** CPU raster of cluster page records (the triangles the WebGPU path pulls). Same fill rule as rasterPageRecords. */
export function rasterPages(
  pages: Array<Pick<PageRec, 'array' | 'attributes' | 'matrix' | 'material'>>,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport,
    pixels = opaqueBackgroundRgba(width, height, background);
  // Callable function alone: it resolves its own pose (contract: `cameraWorld.ts`).
  resolveCameraWorld(camera);
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const world = new THREE.Matrix4();
  for (const page of pages) {
    const position = page.attributes.position,
      index = page.array;
    if (!position || !index) continue;
    const rgb = surfaceColorOf(page.material);
    const attribute = asHostLibrary<THREE.BufferAttribute>(position);
    world.fromArray(page.matrix.elements);
    for (let i = 0; i < index.length; i += 3) {
      projectAttribute(world, attribute, index[i], viewProj, width, height, pa);
      projectAttribute(world, attribute, index[i + 1], viewProj, width, height, pb);
      projectAttribute(world, attribute, index[i + 2], viewProj, width, height, pc);
      fillTriangle(pixels, width, height, pa, pb, pc, rgb);
    }
  }
  return pixels;
}

const projectScratch = new THREE.Vector3();
const pa = { x: 0, y: 0 },
  pb = { x: 0, y: 0 },
  pc = { x: 0, y: 0 };
function projectAttribute(
  matrix: THREE.Matrix4,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vi: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
  out: { x: number; y: number },
) {
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(matrix)
    .applyMatrix4(viewProj);
  out.x = (v.x * 0.5 + 0.5) * width;
  out.y = (1 - (v.y * 0.5 + 0.5)) * height;
}

function project(
  mesh: THREE.Mesh,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: THREE.BufferAttribute | null,
  i: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
  out: { x: number; y: number },
) {
  const vi = index ? index.getX(i) : i;
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(mesh.matrixWorld)
    .applyMatrix4(viewProj);
  out.x = (v.x * 0.5 + 0.5) * width;
  out.y = (1 - (v.y * 0.5 + 0.5)) * height;
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
