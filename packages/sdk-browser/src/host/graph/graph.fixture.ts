/**
 * TEST SCENES BUILT OF THE ENGINE'S OWN GRAPH: every node, surface, texture, light and camera a
 * test hands the engine, made of `./` and the core's numbers — never of a rendering library.
 *
 * The classes are re-exported as they are; the builders below cover the few that a test declares
 * by positional arguments (a camera by its optics, a light by its colour and range, a raw texture
 * by its texels, a box by its sizes), each with fixed defaults, so a test reads in one line and the
 * engine receives only objects of its own graph.
 */
import { Color, type ColorInput } from '../../../../sdk-core/src/world/math/color.ts'
import { box, plane, sphere } from '../../../../sdk-core/src/world/geometry/basic.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Side } from '../../../../sdk-core/src/index.ts'
import { MATERIAL_COLOURS } from '../../../../sdk-core/src/world/material/material.ts'
import type { PageSurface, SurfaceFamily } from '../../page/surface.ts'
import { declareSurface } from '../../page/surfaceRecord.ts'
import type { SurfaceDeclaration } from '../../page/surfaceDeclaration.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { HostAttributes } from '../resources.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'

export { Box3 } from '../../../../sdk-core/src/world/math/box3.ts'
export { Color } from '../../../../sdk-core/src/world/math/color.ts'
export { Euler } from '../../../../sdk-core/src/world/math/euler.ts'
export { Matrix3, Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
export { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
export { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts'
export { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
export {
  BufferAttribute,
  InterleavedBufferAttribute,
  InterleavedBuffer,
} from '../../../../sdk-core/src/world/buffer/attribute.ts'
export { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
export { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
export { Light } from '../../../../sdk-core/src/world/light/light.ts'
export { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
export { InstancedMesh } from '../../../../sdk-core/src/world/object/instancedMesh.ts'
export type { HostMesh } from '../resources.ts'
export { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
export { Scene } from '../../world/core/scene.ts'
export { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
export * from './graphLights.fixture.ts'

/** The faces a surface draws, as a declaration names them. */
export const FRONT_SIDE: Side = 'front',
  BACK_SIDE: Side = 'back',
  DOUBLE_SIDE: Side = 'double'

/** The parameters a surface is declared with, its colours given as a number or a CSS name too. */
export type SurfaceParameters = Record<string, unknown>

/** An empty geometry of the host's, as a loaded scene's is (`Geometry._owner`). */
const hostGeometry = () => Object.assign(new Geometry(), { _owner: 'host' as const })

/** A drawn node: an empty geometry and an unlit surface unless given. */
export const mesh = (
  geometry: Geometry = hostGeometry(),
  material: PageSurface | PageSurface[] = basicSurface(),
) => new Mesh(geometry, material)

/** A drawn triangle — three indices, positions and normals — in `surface`, never culled: what a
 *  draw test submits once per pass. */
export function triangleMesh(surface: PageSurface) {
  const geometry = new Geometry().setIndex(new BufferAttribute(new Uint32Array(3), 1))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  const made = new Mesh(geometry, surface)
  made.frustumCulled = false
  return made
}

/** The host attributes of a triangle in the z = 0 plane: indexed positions only. */
export function triangleAttributes() {
  const geometry = new Geometry()
  geometry.setAttribute('position', floatAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geometry.setIndex(indices([0, 1, 2]))
  return geometry.attributes as HostAttributes
}

/** A surface of each family a scene declares. */
export const basicSurface = (parameters?: SurfaceParameters) => familySurface('basic', parameters)
export const standardSurface = (parameters?: SurfaceParameters) =>
  familySurface('standard', parameters)
export const physicalSurface = (parameters?: SurfaceParameters) =>
  familySurface('physical', parameters)

/** A surface of `family`, whose colours may be given as a number or a CSS name. */
export function familySurface(family: SurfaceFamily, parameters: SurfaceParameters = {}) {
  const declared: Record<string, unknown> = { family }
  for (const [key, value] of Object.entries(parameters))
    declared[key] =
      MATERIAL_COLOURS.has(key) && value !== undefined && typeof value !== 'object'
        ? new Color(value as ColorInput)
        : value
  return declareSurface(declared as SurfaceDeclaration)
}

/** Draws `surface` on `side` from now on: what a host switching faces in place writes. */
export function sided(surface: PageSurface, side: Side) {
  surface.doubleSided = side === 'double'
  surface.backSide = side === 'back'
}

/** Numbers stored as 32-bit floats, `itemSize` per vertex. */
export const floatAttribute = (values: ArrayLike<number>, itemSize: number, normalized = false) =>
  new BufferAttribute(new Float32Array(values), itemSize, normalized)

/** A perspective eye by its optics. */
export const perspectiveCamera = (fov = 50, aspect = 1, near = 0.1, far = 2000) =>
  new Camera('perspective', { fov, aspect, near, far })

/** An orthographic eye by the box it sees. */
export const orthographicCamera = (
  left = -1,
  right = 1,
  top = 1,
  bottom = -1,
  near = 0.1,
  far = 2000,
) => new Camera('orthographic', { near, far, left, right, top, bottom })

/** A texture of raw texels: read as they are, nearest, rows not flipped. */
export function dataTexture(
  data: ArrayBufferView | null = null,
  width = 1,
  height = 1,
  format = 'rgba',
) {
  const texture = new Texture({ data, width, height }, 'data', format)
  texture.magFilter = texture.minFilter = 'nearest'
  texture.flipY = false
  return texture
}

/** A texture drawn on a canvas, uploaded at its first use. */
export const canvasTexture = (canvas: unknown) => new Texture(canvas)

/**
 * A copy of the core's primitive, stored in 32-bit
 * floats per vertex, a 16- or 32-bit triangle list, and its groups.
 */
function graphGeometry(source: Geometry) {
  const geometry = hostGeometry()
  for (const [name, attribute] of Object.entries(source.attributes))
    geometry.setAttribute(name, floatAttribute(attribute.array, attribute.itemSize))
  if (source.index) geometry.setIndex(indices(Array.from(source.index.array)))
  for (const group of source.groups) geometry.groups.push({ ...group })
  return geometry
}

/** A box centred on the origin. */
export const boxGeometry = (...sizes: Parameters<typeof box>) => graphGeometry(box(...sizes))
/** A rectangle in the `xy` plane, facing `+z`. */
export const planeGeometry = (...sizes: Parameters<typeof plane>) => graphGeometry(plane(...sizes))
/** A sphere, its poles on `y`. */
export const sphereGeometry = (...sizes: Parameters<typeof sphere>) =>
  graphGeometry(sphere(...sizes))

/** A triangle list stored in 16-bit while every vertex fits, else 32-bit. */
export const indices = (list: readonly number[]) =>
  new BufferAttribute(
    list.some((i) => i >= 65535) ? new Uint32Array(list) : new Uint16Array(list),
    1,
  )

/** The three numbers of a vector, in order. */
export const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z]

/** The four numbers of a rotation, in order. */
export const xyzw = (q: { x: number; y: number; z: number; w: number }) => [q.x, q.y, q.z, q.w]

/** Where a node stands in the world, its chain resolved first. */
export function worldPosition(node: Object3D, target = new Vector3()) {
  return target.setFromMatrixPosition(resolveCameraWorld(node).matrixWorld)
}

/** The first node of the subtree with that name, the root included. */
export function byName(root: Object3D, name: string) {
  let found: Object3D | undefined
  root.traverse((node) => {
    if (!found && node.name === name) found = node
  })
  return found
}
export * from './kinds.ts'
