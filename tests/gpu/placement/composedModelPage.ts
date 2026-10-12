// Page of the composed-model proof: a world draws a compiled model; the model turns, moves or
// scales while the session runs — its rows follow its world on the GPU, its first move writing and
// linking them, the next ones sending one matrix —, and the image is the one of a world opened with
// the model already there. The models are generated and compiled: a dense sphere cooked with levels
// of detail (the stretch of its placement decides what it draws), a skinned tube whose bones stand
// in its graph, a crowd cut in cells; none is a file of the site.
import { changed, open, type World } from '../world/appendProof.ts'
import { crowdModel } from '../world/generatedModels.ts'
import { skinnedModel } from '../world/generatedSkin.ts'
import { sphereModel } from '../world/generatedShapes.ts'

/** Where the model stands: its position, its turn, its scale. */
type Pose = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number | [number, number, number]
}

const at = (p: Pose, model: Awaited<ReturnType<World['scene']['load']>>) => {
  model.position.set(...p.position)
  model.rotation.set(...p.rotation)
  if (typeof p.scale === 'number') model.scale.setScalar(p.scale)
  else model.scale.set(...p.scale)
}

/** A world whose model goes from pose to pose while it runs — `bend` the angle its knee is turned
 *  to before the last, if it has one —, against a world opened with it at the last. */
async function moved(url: () => string, poses: readonly Pose[], bend?: number) {
  const place = async (world: World, pose: Pose) => {
    world.pixelError = 3
    const model = await world.scene.load(url())
    at(pose, model)
    if (bend !== undefined) model.getObjectByName('knee')!.rotation.z = bend
    return model
  }
  const grown = open()
  try {
    await grown.world.ready
    const model = await place(grown.world, poses[0])
    if (bend !== undefined) model.getObjectByName('knee')!.rotation.z = 0
    let before = await changed(grown.world, '')
    const sessions = grown.world.diagnostic.sessions
    let after = before
    for (const [k, pose] of poses.slice(1).entries()) {
      at(pose, model)
      if (bend !== undefined && k === poses.length - 2)
        model.getObjectByName('knee')!.rotation.z = bend
      after = await changed(grown.world, before)
      before = after
    }
    const reference = open()
    try {
      await reference.world.ready
      await place(reference.world, poses.at(-1)!)
      const opened = await changed(reference.world, '')
      return { after, opened, sessions: [sessions, grown.world.diagnostic.sessions] }
    } finally {
      reference.close()
    }
  } finally {
    grown.close()
  }
}

const sphere = () => sphereModel('sphere', [0.85, 0.45, 0.2, 1])
const skinned = () => skinnedModel('skinned', [0.3, 0.7, 0.4, 1])
const crowd = () => crowdModel('crowd', 48, 50, [0.2, 0.55, 0.85, 1])

/** A dense sphere moved, then scaled uniformly, then scaled unevenly and turned. */
export const runSphere = () =>
  moved(sphere, [
    { position: [-1, 0.5, 0], rotation: [0, 0, 0], scale: 1 },
    { position: [0, 1, -1], rotation: [0, 0.4, 0], scale: 1.2 },
    { position: [1, 1, -4], rotation: [0.2, 0.6, 0], scale: 2.6 },
    { position: [1, 0.5, -2], rotation: [0.3, 0.9, 0.2], scale: [3, 0.7, 1.8] },
  ])

/** A skinned tube moved, its knee bent, moved again. */
export const runSkinned = () =>
  moved(
    skinned,
    [
      { position: [-1, 0, 0], rotation: [0, 0, 0], scale: 1.5 },
      { position: [0, 0, -1], rotation: [0, 0.5, 0], scale: 1.5 },
      { position: [1, 0.5, -2], rotation: [0, 1.1, 0], scale: 2.2 },
    ],
    0.7,
  )

/** A crowd cut in cells moved and scaled under the session. */
export const runCells = () =>
  moved(crowd, [
    { position: [0, 0, -9], rotation: [0, 0, 0], scale: 0.3 },
    { position: [1, 0, -10], rotation: [0, 0.3, 0], scale: 0.3 },
    { position: [-1, 0, -12], rotation: [0, 0.6, 0], scale: 0.35 },
  ])
