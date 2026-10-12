// Page of the append-deform proof: a world draws a row of still meshes, then meshes a skeleton, morph
// weights or waves move, and meshes whose vertices the host rewrites, are added to the scene while
// its session runs (`placement/webgpuAppend.ts`, `deformation/growth.ts`), and the image is the one of
// a world opened on all of them at once. A generated scene: no file of the site.
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { joined, row, type World } from './appendProof.ts'
import {
  ball,
  cloth,
  glass,
  morphed,
  paint,
  rewritten,
  sea,
  short,
  skinned,
  swell,
  tall,
} from './appendDeformScenes.ts'

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
