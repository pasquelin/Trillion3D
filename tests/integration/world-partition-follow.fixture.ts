// A compiled world read whole as a world reads it (`loadModel`), its cells followed by the
// session's per-frame step (`createPartitionFrame`) on an engine stand-in that grows its rows in
// place (`growPlacements`), as the engine does; its cell records read from disk as the runtime
// reads them (`cellRecords`).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Engine } from '../../packages/sdk-browser/src/engine/types.ts'
import { hostFramingCamera } from '../../packages/sdk-browser/src/host/scene/graphObjects.ts'
import type { PlacementRows } from '../../packages/sdk-browser/src/placement/rows.ts'
import { cellReach } from '../../packages/sdk-browser/src/partition/plan.ts'
import { createPageStreamer } from '../../packages/sdk-browser/src/streaming/pageStreamer.ts'
import type { LoadedModel } from '../../packages/sdk-browser/src/world/core/loadedModel.ts'
import {
  createPartitionFrame,
  primePartitions,
} from '../../packages/sdk-browser/src/world/scene/partitionFrame.ts'
import { readCellPage } from '../../packages/sdk-core/src/scene/core/tablePartition.ts'

/** The engine stand-in: the rows it draws, those of its open, each grown one in their place. */
function standIn(opened: Iterable<PlacementRows>) {
  const drawn = new Set(opened)
  const counts = { grown: 0 }
  const backend = {
    worldCut: () => undefined,
    updatePlacements() {},
    growsInPlace: () => true,
    growPlacements(from: PlacementRows, to: PlacementRows) {
      counts.grown++
      if (drawn.delete(from)) drawn.add(to)
    },
  } as Partial<Engine> as Engine
  return { backend, drawn, counts }
}

/**
 * `model`'s cells followed from a 60°, 300 m camera at `eye`, as a session opened now on them: it
 * draws the rows of every host mesh the cells place. `settle` draws frames until the view is
 * complete.
 */
export async function followed(model: LoadedModel, eye: readonly number[]) {
  const [cells] = model.record.scene.partitions
  const streamer = createPageStreamer(cells.pages, model.record.base)
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 300)
  camera.position.set(eye[0], eye[1], eye[2])
  camera.updateMatrixWorld()
  await primePartitions([cells], camera, streamer, true)
  // The engine opens on the rows primed.
  const atOpen = [...model.record.scene.associations.values()].flatMap(({ placements }) =>
    placements ? [placements] : [],
  )
  const engine = standIn(atOpen)
  const renewed = { count: 0 }
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer,
    camera,
    engine: engine.backend,
    renew: () => void renewed.count++,
    budget: { admits: () => true, spend() {} },
  })!
  const settle = async () => {
    for (let step = 0; step < 32; step++) {
      frame()
      if (!(await frame.pending())) break
    }
    return cells.stats()
  }
  return { cells, camera, engine, renewed, settle }
}

/** Asserts every node of `cells` within reach of `camera` has a live row, at its place scaled by
 *  `scale`, in rows the engine draws; returns how many there are. */
export async function assertNoneMissing(
  { cells, camera, engine }: Awaited<ReturnType<typeof followed>>,
  scale = 1,
) {
  const key = (x: number, z: number) => `${Math.round(x * 1e3)},${Math.round(z * 1e3)}`
  const drawn = new Set<string>()
  for (const rows of engine.drawn)
    for (let row = 0; row < rows.capacity; row++)
      if (rows.live[row]) drawn.add(key(rows.matrices[row * 16 + 12], rows.matrices[row * 16 + 14]))
  const eye = camera.position,
    reach = cellReach(camera)
  let near = 0
  for (const { url } of await cellRecords(cells.pages)) {
    const body = JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
    for (const { translation } of body.nodes) {
      const [x, y, z] = translation.map((value: number) => value * scale)
      if (Math.hypot(x - eye.x, y - eye.y, z - eye.z) > reach) continue
      near++
      assert.ok(drawn.has(key(x, z)), `the node at ${[x, y, z]} is drawn`)
    }
  }
  return near
}

/** Every cell record under `pages`, the root's slots of a compiled partition, its address made
 *  whole: read from disk page by page as the runtime reads them (`readCellPage`). */
export async function cellRecords(
  pages: readonly { url: string }[],
): Promise<{ url: string; bytes: number; meshPages: readonly string[] }[]> {
  const lists = await Promise.all(
    pages.map(async ({ url }) => {
      const body = readCellPage(await readFile(fileURLToPath(url)), url)
      const whole = (name: string) => new URL(name, url).href
      if (body.pages) return cellRecords(body.pages.map(({ page }) => ({ url: whole(page.url) })))
      return body.cells.map((cell) => ({ ...cell, url: whole(cell.url) }))
    }),
  )
  return lists.flat()
}
