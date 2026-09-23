import { invertMatrix4, multiplyMatrix4 } from '../../../sdk-core/src/index.ts';
import type {
  HostAttribute,
  HostAttributes,
  HostColour,
  HostMaterials,
  HostNode,
} from '../host/resources.ts';
import { firstMaterial } from '../scene/materialSide.ts';
import { copyElements, type MatrixElements } from '../math/matrixElements.ts';
import type { RenderBackend } from '../backend/types.ts';
import type { PageRec } from './selection/selection.ts';
import type { PageSurface } from './surface.ts';
import { rasterTriangle, type RasterTarget } from './rasterFill.ts';
import { resolveCameraWorld, type HostCamera } from '../camera/world.ts';
import { drawnRanges, submittedDraws } from '../cluster/batchMesh.ts';

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
  const first = firstMaterial(declared) as
    { color?: HostColour & { isColor?: boolean } } | undefined;
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
  const [width, height] = size;
  const target: RasterTarget = {
    pixels: opaqueBackgroundRgba(width, height, BACKGROUND),
    width,
    height,
  };
  const viewProj = cameraViewProjection(camera);
  // A batch record submits only its ranges: the oracle follows the same cut, not the whole buffer.
  for (const draw of submittedDraws(backend)) {
    const index = draw.geometry.index,
      position = draw.geometry.attributes.position,
      world = draw.matrix.elements,
      rgb = colorOf(draw.material),
      vertex = (i: number) => (index ? index.array[i] : i);
    for (const [first, length] of drawnRanges(draw))
      for (let i = first; i < first + length; i += 3)
        rasterTriangle(
          target,
          world,
          position,
          viewProj,
          vertex(i),
          vertex(i + 1),
          vertex(i + 2),
          rgb,
        );
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
    for (let i = 0; i < count; i += 3)
      rasterTriangle(
        target,
        world,
        position,
        viewProj,
        vertex(i),
        vertex(i + 1),
        vertex(i + 2),
        rgb,
      );
  }
  return target.pixels;
}

/** CPU raster of cluster page records (the triangles the WebGPU path pulls). Same fill rule as rasterPageRecords. */
export function rasterPages(
  pages: Array<Pick<PageRec, 'array' | 'attributes' | 'matrix' | 'material'>>,
  camera: HostCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport;
  const target: RasterTarget = {
    pixels: opaqueBackgroundRgba(width, height, background),
    width,
    height,
  };
  const viewProj = cameraViewProjection(camera);
  for (const page of pages) {
    const position = page.attributes.position,
      index = page.array;
    if (!position || !index) continue;
    const rgb = surfaceColorOf(page.material),
      world = page.matrix.elements;
    for (let i = 0; i < index.length; i += 3)
      rasterTriangle(target, world, position, viewProj, index[i], index[i + 1], index[i + 2], rgb);
  }
  return target.pixels;
}

const projection = new Float64Array(16),
  viewWorld = new Float64Array(16),
  view = new Float64Array(16),
  viewProjection = new Float64Array(16);
/** Clip matrix of the drawn view, as the host composed it: its own projection, finite far plane
 *  included, times the inverse of the world pose the contract resolves. The inverse is taken
 *  here, in buffers the engine owns, rather than read off the camera the host handed over. */
function cameraViewProjection(camera: HostCamera) {
  // Callable function alone: it resolves its own pose (contract: `../camera/world.ts`).
  resolveCameraWorld(camera);
  copyElements(projection, camera.projectionMatrix.elements);
  copyElements(viewWorld, camera.matrixWorld.elements);
  invertMatrix4(view, viewWorld);
  multiplyMatrix4(viewProjection, projection, view);
  return viewProjection;
}
