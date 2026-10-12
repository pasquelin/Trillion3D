// The scenes of the append-deform proof (`appendDeformPage.ts`): the meshes a skeleton, morph weights
// or waves move, a geometry the host rewrites, and the still ones beside them. Generated: no file of
// the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { animation } from '../../../packages/sdk-core/src/world/animation/family.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { WaterSurface } from '../../../packages/sdk-core/src/fluids/waterSurface.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import { type World } from './appendProof.ts'

export const ball = geometry.sphere(0.6, 16, 12)
export const paint = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })
export const cloth = material.meshStandard({ color: 0x3a7ab0, roughness: 0.5 })
export const glass = material.meshStandard({
  color: 0x70b03a,
  roughness: 0.4,
  transparent: true,
  opacity: 0.6,
})

/** A column on two joints: the lower the first joint's, the upper the second's, blended between. */
function column(height: number, bones: number) {
  const shape = geometry.box(0.5, height, 0.5, 1, 10, 1),
    position = shape.attributes.position,
    index = new Uint16Array(position.count * 4),
    weight = new Float32Array(position.count * 4)
  for (let v = 0; v < position.count; v++) {
    const t = clamp(position.getY(v) / height + 0.5, 0, 1)
    index.set([0, Math.min(1, bones - 1), 0, 0], v * 4)
    weight.set([1 - t, t, 0, 0], v * 4)
  }
  shape.setAttribute('skinIndex', new BufferAttribute(index, 4))
  shape.setAttribute('skinWeight', new BufferAttribute(weight, 4))
  return shape
}
export const tall = column(1.6, 2)
export const short = column(1.1, 2)

/** A sphere that swells toward +y with its one morph target. */
function swelling() {
  const shape = geometry.sphere(0.6, 16, 12),
    count = shape.attributes.position.count,
    offsets = new Float32Array(count * 3)
  for (let v = 0; v < count; v++)
    offsets[v * 3 + 1] = Math.max(0, shape.attributes.position.getY(v))
  shape.morphTargetsRelative = true
  shape.morphAttributes.position = [new BufferAttribute(offsets, 3)]
  return shape
}
export const swell = swelling()

/** Skinned meshes of `shape` along x at depth `z`, their upper joint bent. */
export function skinned(world: World, shape: typeof tall, z: number, count = 2, bend = 0.7) {
  for (let i = 0; i < count; i++) {
    const at = [(i - (count - 1) / 2) * 1.6, 0.8, z] as const
    const lower = object.group(),
      upper = object.group()
    lower.position.set(...at)
    lower.add(upper)
    const mesh = object.mesh(shape, cloth)
    mesh.position.set(...at)
    world.scene.add(lower, mesh)
    mesh.skeleton = animation.skeleton([lower, upper])
    upper.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, bend + 0.25 * (i % 3))
  }
}

/** Morphed meshes along x at depth `z`, their target weighted. */
export function morphed(world: World, z: number, count = 2) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(swell, paint)
    mesh.position.set((i - (count - 1) / 2) * 1.6, 0.6, z)
    mesh.morphTargetInfluences![0] = 0.3 + 0.35 * (i % 3)
    world.scene.add(mesh)
  }
}

/** A sheet the waves carry, lying at the water's level at depth `z`. */
export function sea(world: World, z: number, paintOf = cloth, count = 1) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(sheet, paintOf)
    mesh.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -HALF_PI)
    mesh.position.set((i - (count - 1) / 2) * 4.2, 0, z)
    mesh.waves = water
    world.scene.add(mesh)
  }
}
const sheet = geometry.plane(4, 3, 40, 30)
const water = new WaterSurface({
  level: 0,
  waves: [{ direction: [1, 0], wavelength: 2.5, amplitude: 0.2, steepness: 0.3 }],
})

/** Meshes whose vertices the host rewrites, read as floats. */
export const rewritten = geometry.sphere(0.6, 16, 12)
rewritten.usage = 'dynamic'
