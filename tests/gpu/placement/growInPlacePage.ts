// Page of the in-place growth proof: the real WebGPU engine, a real device, a real reread image. A
// tile is placed by rows as a partition places its cells' nodes (`partition/rows.ts`): rows sized
// before the session opens, then one more node than they hold, grown under the running session
// through the contract a partition calls (`sizeRows`, `placement/growth.ts`). The reference is a
// session opened on the three placements at once.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import {
  placedMesh,
  sizeRows,
  takeRow,
  type PlacedMesh,
  type RowLink,
} from '../../../packages/sdk-browser/src/partition/rows.ts'
import type { Engine } from '../../../packages/sdk-browser/src/engine/types.ts'
import { batisseur, cameraFace, engine, release, square } from '../kit/sharedSceneProof.ts'
import { difference, drawnPixels, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

/** Half-width of the tile, and the three places its rows put it. */
const HALF = 0.3,
  PLACES = [-0.8, 0, 0.8]

/** A background, and a tile drawn by rows of one placed mesh, its rows sized for `rows`. */
function placedScene(rows: number) {
  const builder = batisseur()
  const background = G.mesh(square(4), G.basicSurface({ color: 0x1b3a5c, side: G.DOUBLE_SIDE }))
  background.position.z = -2
  builder.source.add(background)
  builder.add(background, 'exact-clusters', 4)
  const tile = G.mesh(square(HALF), G.basicSurface({ color: 0xff2020, side: G.DOUBLE_SIDE }))
  builder.source.add(tile)
  builder.add(tile, 'exact-clusters', HALF)
  const scene = builder.fini()
  const link = scene.associations.get(tile) as RowLink
  const mesh = placedMesh([link], [tile])
  sizeRows(new Map([[0, mesh]]), new Map([[0, rows]]))
  return { scene, mesh, link }
}

/** Takes a row of `mesh` at each of `places`, written as a partition writes a node, and tells
 *  `update` — the session's `updatePlacements` once it runs. */
function place(
  { mesh, link }: { mesh: PlacedMesh; link: RowLink },
  places: number[],
  update?: Engine['updatePlacements'],
) {
  for (const x of places) {
    const row = takeRow(mesh),
      rows = link.placements!
    rows.matrices.set(new G.Matrix4().makeTranslation(x, 0, 0).elements, row * 16)
    rows.live[row] = 1
    update?.(rows, row, row)
  }
}

/** Renders until held, waiting for a growth's cut to land: images until one differs from
 *  `before`, then the held one. */
async function settled(backend: Engine, before?: number[] | null) {
  const camera = cameraFace()
  let image = await untilHeld(backend, camera)
  for (let wait = 0; before && wait < 50 && !difference(image.held ?? [], before); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    image = await untilHeld(backend, camera)
  }
  return image.held
}

async function sequence(device: GPUDevice, events: unknown[]) {
  const grown = placedScene(2)
  place(grown, PLACES.slice(0, 2))
  const a = engine(grown.scene, device, (e) => events.push(e))
  const reference = placedScene(3)
  place(reference, PLACES)
  const b = engine(reference.scene, device, (e) => events.push(e))
  try {
    await a.backend.prepare()
    const before = await settled(a.backend)
    // One more node than the rows hold: they grow under the running session, or it would reopen.
    const session = a.backend
    const inPlace = sizeRows(new Map([[0, grown.mesh]]), new Map([[0, 3]]), {
      growsInPlace: (from, capacity) => session.growsInPlace(from, capacity),
      growPlacements: (from, to) => session.growPlacements(from, to),
    })
    place(grown, PLACES.slice(2), session.updatePlacements)
    const after = await settled(a.backend, before)
    await b.backend.prepare()
    const opened = await settled(b.backend)
    if (!before || !after || !opened) throw new Error('an image was never held')
    return {
      inPlace,
      capacity: grown.link.placements!.capacity,
      beforePixels: drawnPixels(before),
      afterPixels: drawnPixels(after),
      grownFromBefore: difference(after, before),
      grownFromOpened: difference(after, opened),
    }
  } finally {
    release(a.backend, a.canvas, grown.scene)
    release(b.backend, b.canvas, reference.scene)
  }
}

/** The growth and the reference, on one device. */
export const run = () =>
  runOnDevice<{ reading: Awaited<ReturnType<typeof sequence>> }>(async (device, events, result) => {
    result.reading = await sequence(device, events)
  })
