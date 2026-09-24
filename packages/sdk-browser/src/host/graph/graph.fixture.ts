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
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { resolveCameraWorld } from '../../camera/world.ts';
import { HOST_FILTER_NEAREST, HOST_FORMAT_RGBA } from '../surfaceConstants.ts';
import { GraphAttribute, type GraphArray } from './attributes.ts';
import { GraphCamera } from './camera.ts';
import { GraphGeometry } from './geometry.ts';
import { GraphLight } from './light.ts';
import { GraphMesh } from './mesh.ts';
import { GraphSurface, type GraphSurfaceFamily } from './surface.ts';
import { GraphTexture } from './texture.ts';
import type { GraphNode } from './node.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';

export { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
export { Color } from '../../../../sdk-core/src/world/math/color.ts';
export { Euler } from '../../../../sdk-core/src/world/math/euler.ts';
export { Matrix3, Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
export { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts';
export { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
export * from '../surfaceConstants.ts';
export { GraphAttribute, GraphInterleavedAttribute, GraphInterleavedBuffer } from './attributes.ts';
export { GraphCamera } from './camera.ts';
export { GraphGeometry } from './geometry.ts';
export { GraphLight } from './light.ts';
export { GraphGroup, GraphMesh } from './mesh.ts';
export { GraphNode } from './node.ts';
export { GraphScene } from './scene.ts';
export { GraphSurface } from './surface.ts';
export { GraphTexture } from './texture.ts';
export { GraphVector } from './vector.ts';

/** The faces a surface draws, as a surface's `side` holds them (`../../scene/materialSide.ts`). */
export const FRONT_SIDE = 0,
  BACK_SIDE = 1,
  DOUBLE_SIDE = 2;

/** The parameters a surface is declared with. */
type SurfaceParameters = Record<string, unknown>;

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
  new GraphAttribute(new Float32Array(values), itemSize, normalized);

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

const colour = (value: ColorInput | undefined) => new Color(value ?? 0xffffff);

/** A light that shines one way from far off. */
export function directionalLight(color?: ColorInput, intensity = 1) {
  const light = new GraphLight('directional', colour(color));
  light.intensity = intensity;
  return light;
}

/** A light that shines every way from a point, fading with distance. */
export function pointLight(color?: ColorInput, intensity = 1, distance = 0, decay = 2) {
  const light = new GraphLight('point', colour(color));
  Object.assign(light, { intensity, distance, decay });
  return light;
}

/** A light that shines in a cone. */
export function spotLight(
  color?: ColorInput,
  intensity = 1,
  distance = 0,
  angle = Math.PI / 3,
  penumbra = 0,
  decay = 2,
) {
  const light = new GraphLight('spot', colour(color));
  Object.assign(light, { intensity, distance, angle, penumbra, decay });
  return light;
}

/** A texture of raw texels: read as they are, nearest, no mips, rows not flipped. */
export function dataTexture(
  data: ArrayBufferView | null = null,
  width = 1,
  height = 1,
  format = HOST_FORMAT_RGBA,
) {
  const texture = new GraphTexture({ data, width, height });
  Object.assign(texture, { isDataTexture: true, format });
  texture.magFilter = texture.minFilter = HOST_FILTER_NEAREST;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** The core's primitive as a geometry of the graph: its attributes, index and groups. */
function graphGeometry(source: Geometry) {
  const geometry = new GraphGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    geometry.setAttribute(
      name,
      new GraphAttribute(attribute.array as GraphArray, attribute.itemSize, attribute.normalized),
    );
  if (source.index) geometry.setIndex(new GraphAttribute(source.index.array as GraphArray, 1));
  for (const group of source.groups) geometry.groups.push({ ...group });
  return geometry;
}

/** A box centred on the origin. */
export const boxGeometry = (...sizes: Parameters<typeof box>) => graphGeometry(box(...sizes));

/** A triangle list as the reference stores one: 16-bit while every vertex fits, else 32-bit. */
export const indices = (list: readonly number[]) =>
  new GraphAttribute(
    list.some((i) => i >= 65535) ? new Uint32Array(list) : new Uint16Array(list),
    1,
  );

/** The three numbers of a vector, in order. */
export const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];

/** The four numbers of a rotation, in order. */
export const xyzw = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w];

/** Where a node stands in the world, its chain resolved first. */
export function worldPosition(node: GraphNode, target = new Vector3()) {
  return target.setFromMatrixPosition(resolveCameraWorld(node).matrixWorld);
}
