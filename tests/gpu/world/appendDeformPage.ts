// Page of the append-deform proof: a world draws a row of still meshes, then meshes a skeleton, morph
// weights or waves move, and meshes whose vertices the host rewrites, are added to the scene while
// its session runs (`placement/webgpuAppend.ts`, `deformation/growth.ts`), and the image is the one of
// a world opened on all of them at once. A generated scene: no file of the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { animation } from '../../../packages/sdk-core/src/world/animation/family.ts'
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts'
import { WaterSurface } from '../../../packages/sdk-core/src/fluids/waterSurface.ts'
import { joined, row, type World } from './appendProof.ts'

const ball = geometry.sphere(0.6, 16, 12)
const paint = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })
const cloth = material.meshStandard({ color: 0x3a7ab0, roughness: 0.5 })
const glass = material.meshStandard({
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
    const t = Math.min(1, Math.max(0, position.getY(v) / height + 0.5))
    index.set([0, Math.min(1, bones - 1), 0, 0], v * 4)
    weight.set([1 - t, t, 0, 0], v * 4)
  }
  shape.setAttribute('skinIndex', new BufferAttribute(index, 4))
  shape.setAttribute('skinWeight', new BufferAttribute(weight, 4))
  return shape
}
const tall = column(1.6, 2)
const short = column(1.1, 2)

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
const swell = swelling()

/** Skinned meshes of `shape` along x at depth `z`, their upper joint bent. */
function skinned(world: World, shape: typeof tall, z: number, count = 2, bend = 0.7) {
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
function morphed(world: World, z: number, count = 2) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(swell, paint)
    mesh.position.set((i - (count - 1) / 2) * 1.6, 0.6, z)
    mesh.morphTargetInfluences![0] = 0.3 + 0.35 * (i % 3)
    world.scene.add(mesh)
  }
}

/** A sheet the waves carry, lying at the water's level at depth `z`. */
function sea(world: World, z: number, paintOf = cloth, count = 1) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(sheet, paintOf)
    mesh.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2)
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
const rewritten = geometry.sphere(0.6, 16, 12)
rewritten.usage = 'dynamic'

const held =
  (...contents: Array<(world: World) => void>) =>
  (world: World) => {
    row(world, ball, paint, 2)
    for (const content of contents) content(world)
  }

/** A skinned geometry in a session that moves nothing: the stage is made for it. */
export const runSkinnedFirst = () => joined(held(), (world) => skinned(world, tall, -1))

/** Skinned meshes joining a session that moves skinned meshes already. */
export const runSkinned = () =>
  joined(
    held((world) => skinned(world, tall, -1)),
    (world) => skinned(world, short, -3),
  )

/** More meshes of the batch the session holds: its rows grow, a record each. */
export const runSkinnedRows = () =>
  joined(
    held((world) => skinned(world, tall, -1, 1)),
    (world) => skinned(world, tall, -3, 5),
  )

/** Morphed meshes in a session that moves nothing. */
export const runMorphFirst = () => joined(held(), (world) => morphed(world, -1))

/** Morphed meshes, then another batch of them. */
export const runMorph = () =>
  joined(
    held((world) => morphed(world, -1, 1)),
    (world) => morphed(world, -3, 4),
  )

/** A sea in a session that moves nothing. */
export const runWavedFirst = () => joined(held(), (world) => sea(world, -2))

/** A sea beside one the session holds, and more sheets of the held one. */
export const runWavedRows = () =>
  joined(
    held((world) => sea(world, -2)),
    (world) => sea(world, -5, cloth, 3),
  )

/** A translucent sea: a blended copy the waves move. */
export const runWavedBlended = () => joined(held(), (world) => sea(world, -2, glass))

/** Meshes whose vertices are read as floats, in a session that reads none. */
export const runFloats = () => joined(held(), (world) => row(world, rewritten, cloth, -1))

/** Everything at once, one after the other. */
export const runAll = () =>
  joined(held(), (world) => {
    skinned(world, tall, -1)
    morphed(world, -3)
    sea(world, -5)
    row(world, rewritten, cloth, -7)
  })
export const dbgSkin2 = () =>
  joined(
    held((world) => skinned(world, tall, -1, 2)),
    () => {},
  )
export const dbgSea3 = () =>
  joined(
    held((world) => sea(world, -5, cloth, 3)),
    () => {},
  )

/** Two meshes of one batch posed by `weights`, one morph weight each. */
function posedMorphs(world: World, weights: number[]) {
  weights.forEach((weight, i) => {
    const mesh = object.mesh(swell, paint)
    mesh.position.set((i - (weights.length - 1) / 2) * 1.6, 0.6, -1)
    mesh.morphTargetInfluences![0] = weight
    world.scene.add(mesh)
  })
}

/** The images of two rows of one batch posed differently, in either order, and alike: each row
 *  draws its own pose, so the three differ, and each is stable (a fresh open and a grown world
 *  agree on it). */
export async function runPoses() {
  const images = []
  for (const weights of [
    [0.2, 0.9],
    [0.9, 0.2],
    [0.2, 0.2],
  ]) {
    const result = await joined(
      held((world) => posedMorphs(world, weights)),
      (world) => row(world, ball, paint, -9, 1),
    )
    images.push(result)
  }
  return {
    opened: images.map((image) => image.opened),
    agree: images.map((image) => image.after === image.opened),
    sessions: images.map((image) => image.sessions),
  }
}
