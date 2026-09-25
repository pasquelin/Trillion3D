/**
 * TEST SCENES BUILT OF THE ENGINE'S OWN GRAPH: every node, surface, texture, light and camera a
 * test hands the engine, made of `./` and the core's numbers — never of a rendering library.
 *
 * The classes are re-exported as they are; the builders below cover the few that a test declares
 * with the reference's argument lists (a camera by its optics, a light by its colour and range, a
 * raw texture by its texels, a box by its sizes), each at the reference's defaults, so a
 * test reads as it did and the engine receives only objects of its own graph.
 */
import { Color, type ColorInput } from '../../../../sdk-core/src/world/math/color.ts';
import { box, plane, sphere } from '../../../../sdk-core/src/world/geometry/basic.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { resolveCameraWorld } from '../../camera/world.ts';
import { HOST_FILTER_NEAREST, HOST_FORMAT_RGBA } from '../surfaceConstants.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphCamera } from './camera.ts';
import { GraphGeometry } from './geometry.ts';
import { GraphMesh } from './mesh.ts';
import { GraphSurface, type GraphSurfaceFamily } from './surface.ts';
import { GraphTexture } from './texture.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';

export { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
export { Color } from '../../../../sdk-core/src/world/math/color.ts';
export { Euler } from '../../../../sdk-core/src/world/math/euler.ts';
export { Matrix3, Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
export { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
export { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
export { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
export * from '../surfaceConstants.ts';
export {
  BufferAttribute,
  InterleavedBufferAttribute,
  InterleavedBuffer,
} from '../../../../sdk-core/src/world/buffer/attribute.ts';
export { GraphCamera } from './camera.ts';
export { GraphGeometry } from './geometry.ts';
export { GraphLight } from './light.ts';
export { GraphMesh } from './mesh.ts';
export { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
export { GraphNode } from './node.ts';
export { GraphScene } from './scene.ts';
export { GraphSurface } from './surface.ts';
export { GraphTexture } from './texture.ts';
export * from './graphLights.fixture.ts';

/** The faces a surface draws, as a surface's `side` holds them (`../../scene/materialSide.ts`). */
export const FRONT_SIDE = 0,
  BACK_SIDE = 1,
  DOUBLE_SIDE = 2;

/** The parameters a surface is declared with. */
export type SurfaceParameters = Record<string, unknown>;

/** The depth test that passes only strictly nearer. */
export const DEPTH_LESS = 2;

/** A drawn node: an empty geometry and an unlit surface unless given. */
export const mesh = (
  geometry: GraphGeometry = new GraphGeometry(),
  material: GraphSurface | GraphSurface[] = new GraphSurface('basic'),
) => new GraphMesh(geometry, material);

/** A surface of each family a scene declares. */
export const basicSurface = (parameters?: SurfaceParameters) => surface('basic', parameters);
export const standardSurface = (parameters?: SurfaceParameters) => surface('standard', parameters);
export const physicalSurface = (parameters?: SurfaceParameters) => surface('physical', parameters);

/** A surface whose colours may be given as a number or a CSS name, as the reference takes them. */
function surface(family: GraphSurfaceFamily, parameters: SurfaceParameters = {}) {
  const made = new GraphSurface(family);
  const colours: SurfaceParameters = {};
  for (const [key, value] of Object.entries(parameters))
    colours[key] =
      (made[key] as Color | undefined)?.isColor && typeof value !== 'object'
        ? new Color(value as ColorInput)
        : value;
  return new GraphSurface(family, colours);
}

/** Numbers stored as 32-bit floats, `itemSize` per vertex. */
export const floatAttribute = (values: ArrayLike<number>, itemSize: number, normalized = false) =>
  new BufferAttribute(new Float32Array(values), itemSize, normalized);

/** A perspective eye by its optics. */
export const perspectiveCamera = (fov = 50, aspect = 1, near = 0.1, far = 2000) =>
  new GraphCamera({ fov, aspect, near, far });

/** An orthographic eye by the box it sees. */
export const orthographicCamera = (
  left = -1,
  right = 1,
  top = 1,
  bottom = -1,
  near = 0.1,
  far = 2000,
) => new GraphCamera({ near, far }, { left, right, top, bottom });

/** A texture of raw texels: read as they are, nearest, no mips, rows not flipped. */
export function dataTexture(
  data: ArrayBufferView | null = null,
  width = 1,
  height = 1,
  format = HOST_FORMAT_RGBA,
) {
  const texture = new GraphTexture({ data, width, height });
  Object.assign(texture, { kind: 'texels', format });
  texture.magFilter = texture.minFilter = HOST_FILTER_NEAREST;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** A texture drawn on a canvas, uploaded at its first use. */
export function canvasTexture(canvas: unknown) {
  const texture = new GraphTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The core's primitive as a geometry of the graph, stored as the reference stores its own: 32-bit
 * floats per vertex, a 16- or 32-bit triangle list, and its groups.
 */
function graphGeometry(source: Geometry) {
  const geometry = new GraphGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    geometry.setAttribute(name, floatAttribute(attribute.array, attribute.itemSize));
  if (source.index) geometry.setIndex(indices(Array.from(source.index.array)));
  for (const group of source.groups) geometry.groups.push({ ...group });
  return geometry;
}

/** A box centred on the origin. */
export const boxGeometry = (...sizes: Parameters<typeof box>) => graphGeometry(box(...sizes));
/** A rectangle in the `xy` plane, facing `+z`. */
export const planeGeometry = (...sizes: Parameters<typeof plane>) => graphGeometry(plane(...sizes));
/** A sphere, its poles on `y`. */
export const sphereGeometry = (...sizes: Parameters<typeof sphere>) =>
  graphGeometry(sphere(...sizes));

/** A triangle list as the reference stores one: 16-bit while every vertex fits, else 32-bit. */
export const indices = (list: readonly number[]) =>
  new BufferAttribute(
    list.some((i) => i >= 65535) ? new Uint32Array(list) : new Uint16Array(list),
    1,
  );

/** The three numbers of a vector, in order. */
export const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];

/** The four numbers of a rotation, in order. */
export const xyzw = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w];

/** Where a node stands in the world, its chain resolved first. */
export function worldPosition(node: Object3D, target = new Vector3()) {
  return target.setFromMatrixPosition(resolveCameraWorld(node).matrixWorld);
}

/** The first node of the subtree with that name, the root included. */
export function byName(root: Object3D, name: string) {
  let found: Object3D | undefined;
  root.traverse((node) => {
    if (!found && node.name === name) found = node;
  });
  return found;
}
export * from './kinds.ts';
