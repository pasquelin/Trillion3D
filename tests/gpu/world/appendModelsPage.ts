// Page of the append-models proof: a world draws a row of meshes, then compiled models are added to
// its scene while its session runs — a model the compiler stacked coplanar surfaces in, a model
// whose cells a partition reads by distance, a crowd past a stream unit — and the image is the one
// of a world opened on all of them at once. A model that leaves the scene is parked, and drawn again
// where the scene takes it back. Generated scenes and the compiler's coplanar fixtures: no file of
// the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { changed, frame, joined, open, row, type World } from './appendProof.ts'
import { coplanarModel, crowdModel } from './generatedModels.ts'

const ball = geometry.sphere(0.6, 16, 12)
const paint = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })

/** A model of the world, at the place its case gives it. */
async function placed(world: World, url: string, x: number, z: number, scale = 0.15, y = 0) {
  const model = await world.scene.load(url)
  model.position.set(x, y, z)
  model.scale.setScalar(scale)
  return model
}

/** The row of meshes every case starts from. */
const meshes = (world: World) => row(world, ball, paint, -2)

/** The coplanar models, the first of them the one a session is based on. */
const stack = () => coplanarModel('three-stack')
const overlay = () => coplanarModel('blend-overlay')
const overlap = () => coplanarModel('partial-overlap')

/** A crowd past a stream unit — twenty-four hundred cubes: the compiler cuts it in cells. */
const crowd = () => crowdModel('crowd', 48, 50, [0.2, 0.55, 0.85, 1])
/** The same crowd cooked with its world DAG (`qem-endpoints`): its far cells are drawn by super-roots. */
const crowdDag = () => crowdModel('crowd-dag', 48, 50, [0.85, 0.3, 0.3, 1], 'qem-endpoints')
/** A crowd the stream unit holds: one model, no cell. */
const small = () => crowdModel('small', 6, 4, [0.85, 0.7, 0.2, 1])

/** A second model beside the one the session is based on. */
export const run = () =>
  joined(
    async (world) => (meshes(world), void (await placed(world, stack(), -3, 1))),
    async (world) => void (await placed(world, overlap(), 3, 1)),
  )

/** A second model whose coplanar layers the session was opened without: the slots are granted. */
export const runLayers = () =>
  joined(
    async (world) => (meshes(world), void (await placed(world, overlay(), -3, 1))),
    async (world) => void (await placed(world, stack(), 3, 1)),
  )

/** Two models, one after the other. */
export const runTwo = () =>
  joined(
    async (world) => (meshes(world), void (await placed(world, overlay(), 0, 1))),
    async (world) => {
      await placed(world, stack(), -3, 1)
      await placed(world, overlap(), 3, 1)
    },
  )

/** A model in a session that draws meshes alone: it joins as a session's first, its images read. */
export const runFirst = () =>
  joined(meshes, async (world) => void (await placed(world, stack(), -3, 1)))

/** A model a stream unit holds, no cell. */
export const runSmall = () =>
  joined(
    async (world) => (meshes(world), void (await placed(world, overlay(), -3, 1))),
    async (world) => void (await placed(world, small(), 3, 3, 0.4)),
  )

/** A model cut in cells, in a session that draws a model. */
export const runPartitioned = () =>
  joined(
    async (world) => (meshes(world), void (await placed(world, overlay(), -3, 1))),
    async (world) => void (await placed(world, crowd(), 0, -9, 0.3)),
  )

/** A model cut in cells with its world DAG, so far along the camera's view that its cells are drawn
 *  by the DAG's super-roots, beside a model. */
export const runWorldDag = () =>
  joined(
    async (world) => {
      // The world DAG stands in for a cell where the error it adds is under the pixel's.
      world.pixelError = 1
      meshes(world)
      await placed(world, overlay(), -3, 1)
    },
    async (world) => void (await placed(world, crowdDag(), 0, -1239, 0.3, -826)),
  )

/** A model cut in cells, in a session that draws meshes alone. */
export const runPartitionedFirst = () =>
  joined(meshes, async (world) => void (await placed(world, crowd(), 0, -9, 0.3)))

/** A model the scene loses is parked: the image is the one of a world that never had it, and it
 *  is drawn again, as it was, once the scene takes it back. */
export async function runRemoved() {
  const [first, cells] = [stack(), crowd()]
  const held = async (world: World) => {
    meshes(world)
    return Promise.all([placed(world, first, -3, 1), placed(world, cells, 0, -9, 0.3)])
  }
  const grown = open()
  try {
    await grown.world.ready
    const [, people] = await held(grown.world)
    const full = await frame(grown.world)
    const sessions = [grown.world.diagnostic.sessions]
    grown.world.scene.remove(people)
    const without = await changed(grown.world, full)
    grown.world.scene.add(people)
    const back = await changed(grown.world, without)
    sessions.push(grown.world.diagnostic.sessions)
    const bare = open()
    try {
      await bare.world.ready
      meshes(bare.world)
      await placed(bare.world, first, -3, 1)
      return { full, without, back, bare: await changed(bare.world, ''), sessions }
    } finally {
      bare.close()
    }
  } finally {
    grown.close()
  }
}
