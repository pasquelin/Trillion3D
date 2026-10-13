// The world of one case of the family (`runtimeFamilyCases.ts`), made at run time — no cooked proxy —: the
// floor, the shapes as their meshes, the camera. The background is black and the one light is a hemisphere
// of no intensity, so a floor shows only what it reflects and a dark body brings back nothing.
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import {
  BufferAttribute,
  animation,
  createWorld,
  geometry,
  light,
  material,
  math,
  object,
  type Geometry,
  type Object3D,
} from '../../../packages/sdk-browser/src/index.ts'
import type { FamilyCase, Rgb, Shape } from './runtimeFamilyCases.ts'

const hex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(1, v) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** The geometry of `s` in its own frame (`Shape`): the post and the torus along y, the quad and the disc
 *  in the plane y = 0, a morph's sphere with one target that stretches it along y. */
function shapeGeometry(s: Shape): Geometry {
  const [a, b, c] = s.size
  switch (s.kind) {
    case 'sphere':
      return geometry.sphere(a, 24, 14)
    case 'morph': {
      const g = geometry.sphere(a, 24, 14)
      const at = g.getAttribute('position')!
      const delta = new Float32Array(at.count * 3)
      for (let k = 0; k < at.count; k++) delta[k * 3 + 1] = 0.6 * at.getY(k)
      g.morphTargetsRelative = true
      g.morphAttributes.position = [new BufferAttribute(delta, 3)]
      return g
    }
    case 'box':
      return geometry.box(2 * a, 2 * b, 2 * c)
    case 'torus':
      return geometry.torus(a, b, 12, 40).rotateX(HALF_PI)
    case 'post':
      return geometry.cylinder(a, a, 2 * b, 24)
    case 'skinned': {
      // Two bones at the post's middle: the lower holds the foot, the upper the top, each vertex weighing
      // them linearly in height.
      const g = geometry.cylinder(a, a, 2 * b, 24)
      const at = g.getAttribute('position')!
      const index = new Uint16Array(at.count * 4),
        weight = new Float32Array(at.count * 4)
      for (let k = 0; k < at.count; k++) {
        const up = (at.getY(k) + b) / (2 * b)
        index[k * 4 + 1] = 1
        weight[k * 4] = 1 - up
        weight[k * 4 + 1] = up
      }
      g.setAttribute('skinIndex', new BufferAttribute(index, 4))
      g.setAttribute('skinWeight', new BufferAttribute(weight, 4))
      return g
    }
    case 'quad':
      return geometry.plane(2 * a, 2 * b).rotateX(-HALF_PI)
    case 'disc':
      return geometry.circle(a, 32).rotateX(-HALF_PI)
  }
}

/** `s` as a mesh at `at` (its centre, or where its move ends). */
function shapeMesh(s: Shape) {
  const peak = Math.max(...s.emission, 1e-6)
  const mesh = object.mesh(
    shapeGeometry(s),
    material.meshStandard({
      color: hex(s.albedo),
      emissive: s.emission.some((v) => v > 0)
        ? hex(s.emission.map((v) => v / peak) as Rgb)
        : '#000000',
      emissiveIntensity: peak,
      opacity: s.opacity,
      transparent: s.opacity < 1,
      side: s.kind === 'quad' || s.kind === 'disc' ? 'double' : 'front',
    }),
  )
  const [cy, sy, cp, sp] = [
    Math.cos(s.yaw / 2),
    Math.sin(s.yaw / 2),
    Math.cos(s.pitch / 2),
    Math.sin(s.pitch / 2),
  ]
  // The turn of `Shape`: pitch about x, then yaw about y.
  mesh.quaternion.set(cy * sp, cp * sy, -sy * sp, cy * cp)
  mesh.position.set(...s.centre)
  if (s.kind === 'morph') mesh.morphTargetInfluences![0] = s.weight
  return mesh
}

/** The world of case `c` on `canvas`; `moved()` carries the moving shapes to where their moves end. */
export function familyWorld(canvas: HTMLCanvasElement, c: FamilyCase) {
  const world = createWorld(canvas)
  world.scene.background = math.color('#000000')
  const { metal, roughness, albedo } = c.floor
  const floor = object.mesh(
    geometry.box(60, 0.2, 60),
    material.meshStandard({ color: hex(albedo), metalness: metal ? 1 : 0, roughness }),
  )
  floor.position.y = -0.1
  const meshes = c.shapes.map(shapeMesh)
  // A skinned shape's two bones stand at its centre, in the scene, before the skeleton takes the bind pose.
  const uppers = new Map<number, Object3D>()
  c.shapes.forEach((s, k) => {
    if (s.kind !== 'skinned') return
    const bones = [object.group(), object.group()]
    for (const bone of bones) bone.position.set(...s.centre)
    world.scene.add(...bones)
    meshes[k].skeleton = animation.skeleton(bones)
    uppers.set(k, bones[1])
  })
  world.scene.add(
    floor,
    ...meshes,
    light.hemisphere({ color: '#ffffff', groundColor: '#ffffff', intensity: 0 }),
  )
  world.camera.set({ position: [...c.eye], target: [...c.target], fov: c.fov })
  world.temporalAntialiasing = c.temporal
  const moved = () =>
    c.shapes.forEach((s, k) => {
      const upper = uppers.get(k)
      if (upper) upper.position.set(s.centre[0] + s.move[0], s.centre[1], s.centre[2] + s.move[2])
      else
        meshes[k].position.set(
          s.centre[0] + s.move[0],
          s.centre[1] + s.move[1],
          s.centre[2] + s.move[2],
        )
    })
  return { world, moved }
}
