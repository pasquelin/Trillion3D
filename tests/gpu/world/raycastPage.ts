// Page of the ray proof (`raycast.gpu.ts`): a world draws a generated scene — two still quads, a
// box, a quad its morph target moves a unit toward the eye, a helper mark before the box, a hidden
// quad before a third one, a blended quad, and a box behind the camera, out of every view —, then each ray of `RAYS` is cast with `world.raycast` and its answer read
// beside the oracle's (`raycastOracle.ts`): the object, the distance, the normal and the triangle,
// in doubles from the meshes the page built. A generated scene: no file of the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import type { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { Ray } from '../../../packages/sdk-core/src/world/math/volumes.ts'
import { markHelper } from '../../../packages/sdk-browser/src/world/core/helperMark.ts'
import { drawnTriangles, nearestTriangle } from './raycastOracle.ts'
import { frame, open, type World } from './appendProof.ts'

const paint = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })
const glass = material.meshStandard({ color: 0x70b03a, transparent: true, opacity: 0.5 })

/** A 2 × 2 quad facing +z whose one morph target moves every corner a unit toward +z. */
function movingQuad() {
  const shape = geometry.plane(2, 2),
    count = shape.attributes.position.count,
    offsets = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) offsets[v * 3 + 2] = 1
  shape.morphTargetsRelative = true
  shape.morphAttributes.position = [new BufferAttribute(offsets, 3)]
  return shape
}

/** The scene: each mesh named, at its place; the helper and the hidden quad the rays pass by. */
function build(world: World) {
  const at = (mesh: Mesh, name: string, x: number, y: number, z: number) => {
    mesh.name = name
    mesh.position.set(x, y, z)
    world.scene.add(mesh)
    return mesh
  }
  const meshes = {
    still: at(object.mesh(geometry.plane(2, 2), paint), 'still', 0, 0, -3),
    low: at(object.mesh(geometry.plane(2, 2), paint), 'low', 0, -2.5, -3),
    box: at(object.mesh(geometry.box(1, 1, 1), paint), 'box', -3, 0, -3),
    moved: at(object.mesh(movingQuad(), paint), 'moved', 3, 0, -3),
    helper: at(markHelper(object.mesh(geometry.plane(1, 1), paint)), 'helper', -3, 0, -1),
    hidden: at(object.mesh(geometry.plane(2, 2), paint), 'hidden', 0, -2.5, -1),
    glass: at(object.mesh(geometry.plane(2, 2), glass), 'glass', 0, 2.5, -3),
    // Behind the camera (`frame`, at (0, 6, 9) looking at the origin): out of every view.
    behind: at(object.mesh(geometry.box(1, 1, 1), paint), 'behind', 0, 0, 20),
  }
  meshes.moved.morphTargetInfluences![0] = 1
  meshes.hidden.visible = false
  return meshes
}
type Meshes = ReturnType<typeof build>

/** The rays: an origin, a direction, the options, and the meshes the oracle reads for it. */
const RAYS: Array<{
  name: string
  origin: number[]
  direction: number[]
  options?: (m: Meshes) => { objects?: Mesh[]; helpers?: boolean }
  meets: (keyof Meshes)[]
}> = [
  { name: 'still, one triangle', origin: [0.7, 0.2, 5], direction: [0, 0, -1], meets: ['still'] },
  { name: 'still, the same one', origin: [0.6, 0.1, 5], direction: [0, 0, -1], meets: ['still'] },
  { name: 'still, the other', origin: [-0.7, -0.2, 5], direction: [0, 0, -1], meets: ['still'] },
  { name: 'moved where drawn', origin: [3.3, 0.2, 5], direction: [0, 0, -1], meets: ['moved'] },
  { name: 'box past the helper', origin: [-3, 0.1, 5], direction: [0, 0, -1], meets: ['box'] },
  {
    name: 'the helper when asked',
    ...{ origin: [-3, 0.1, 5], direction: [0, 0, -1], meets: ['helper', 'box'] },
    options: () => ({ helpers: true }),
  },
  { name: 'past the hidden quad', origin: [0.3, -2.4, 5], direction: [0, 0, -1], meets: ['low'] },
  {
    name: 'oblique, the box',
    ...{ origin: [-1, 0.2, 5], direction: [-2, -0.1, -7.5], meets: ['still', 'box'] },
  },
  { name: 'inside the box', origin: [-3, 0.1, -3], direction: [0, 0, 1], meets: ['box'] },
  {
    name: 'only the box',
    ...{ origin: [-3, 0.1, 5], direction: [0, 0, -1], meets: ['box'] },
    options: (m) => ({ objects: [m.box] }),
  },
  {
    name: 'only the still quad',
    ...{ origin: [-3, 0.1, 5], direction: [0, 0, -1], meets: [] },
    options: (m) => ({ objects: [m.still] }),
  },
  { name: 'a blended quad', origin: [0.3, 2.7, 5], direction: [0, 0, -1], meets: ['glass'] },
  { name: 'out of every view', origin: [0.1, 0.2, 30], direction: [0, 0, -1], meets: ['behind'] },
  { name: 'nothing', origin: [0, 9, 5], direction: [0, 0, -1], meets: [] },
]

/** Each ray's answer beside the oracle's: the object's name, the distance, the normal, the face,
 *  and the oracle's own triangle, `mesh:rank`, which the faces are compared by. */
export async function run() {
  const { world, close } = open()
  try {
    await world.ready
    const meshes = build(world)
    await frame(world)
    const readings = []
    for (const ray of RAYS) {
      const direction = new Vector3(...(ray.direction as [number, number, number])).normalize()
      const d = [direction.x, direction.y, direction.z]
      const triangles = ray.meets.flatMap((name) => drawnTriangles(meshes[name]))
      const expected = nearestTriangle(triangles, ray.origin, d)
      const cast = new Ray(new Vector3(...(ray.origin as [number, number, number])), direction)
      const hit = await world.raycast(cast, ray.options?.(meshes) ?? {})
      readings.push({
        name: ray.name,
        got: hit && {
          object: hit.object.name,
          distance: hit.distance,
          normal: hit.normal.toArray(),
          face: hit.face,
        },
        expected: expected && {
          object: expected.triangle.mesh.name,
          distance: expected.distance,
          normal: expected.normal,
          triangle: `${expected.triangle.mesh.name}:${expected.triangle.rank}`,
        },
      })
    }
    return { readings, errors: [] }
  } catch (error) {
    return { error: error instanceof Error ? error.stack : String(error) }
  } finally {
    close()
  }
}
