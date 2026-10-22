import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { pose } from '../../scene/host/prepared/nodes.ts'
import { chainWorld } from '../../../../../tests/kit/assert/chainWorld.ts'
import type { PlacementRows } from '../../placement/rows/rows.ts'
import { resolveWorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { between, cellUrl, io, noBudget, opened, settled, world } from './cells.fixture.ts'
import { sizedWhole } from './cells.fixture.ts'
import { rowCell } from './rowCells.ts'

const row = (rows: PlacementRows, at: number) => [...rows.matrices.subarray(at * 16, at * 16 + 16)]

test('the cells a camera needs are asked nearest first, then placed on rows once read', async () => {
  const { cells, links, bytes } = await sizedWhole(world())
  const { port, asked, updates, held } = io(bytes)
  await settled(cells, between, port, noBudget)
  assert.deepEqual([...new Set(asked)], [cellUrl('far.json'), cellUrl('near.json')])
  assert.deepEqual(cells.stats(), { pages: 3, cells: 2, held: 0, waiting: 0, rows: 3 })
  asked.forEach((url) => held.add(url))
  await settled(cells, between, port, noBudget)
  assert.equal(cells.stats().held, 2)
  for (const link of links) assert.deepEqual([...link.placements!.live.subarray(0, 3)], [1, 1, 1])
  assert.ok(updates.length >= 2, 'the session is told which rows were written')
})

test('a row holds the world matrix the engine composes for the same node under its parent', async () => {
  const { cells, links, core, bytes, node } = await sizedWhole(world())
  const { port, held } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  await settled(cells, between, port, noBudget)
  const child = new Object3D()
  pose(child, node(5000, 0))
  core.add(child)
  const expected = [...chainWorld(child)]
  const rows = links[1].placements!
  const at = [0, 1, 2].find((index) => row(rows, index)[12] === expected[12])!
  assert.deepEqual(row(rows, at), expected, 'the same bits as a host node there')
  // The parent moves: the rows under it follow before the next frame.
  core.position.set(0, 20, 0)
  cells.frame(between, port, noBudget)
  assert.deepEqual(row(rows, at), [...chainWorld(child)])
})

test('a cell past its range gives its rows back, parked, for the next cell to take', async () => {
  const { cells, links, bytes } = await sizedWhole(world())
  const { port, held, updates } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  await settled(cells, between, port, noBudget)
  updates.length = 0
  cells.frame([0, 0, 0], port, noBudget)
  assert.equal(cells.stats().held, 1, 'the far cell left')
  const live = links[0].placements!.live
  assert.equal(
    live.reduce((sum, flag) => sum + flag, 0),
    2,
  )
  assert.ok(updates.length, 'the parked row is sent')
})

test('the first frame draws what the first camera reaches: its pages and cells read at open', async () => {
  const { cells, links, bytes } = world(null)
  const urls: string[] = []
  const read = await opened(cells, (url) => (urls.push(url), bytes(url)))
  // The top index page and the near region page on its way, and the near cell: not the far one.
  // The rows hold what the grids' ranges can place: both cells' nodes.
  assert.deepEqual(cells.stats(), { pages: 2, cells: 1, held: 1, waiting: 0, rows: 3 })
  assert.deepEqual(
    urls.filter((url) => !url.includes('/scene-page-')),
    [cellUrl('near.json')],
  )
  assert.equal(urls.length, 3, 'two pages and one cell')
  assert.equal(
    read,
    urls.reduce((sum, url) => sum + bytes(url).byteLength, 0),
  )
  assert.deepEqual([...links[0].placements!.live].sort(), [0, 1, 1])
})

test('a parent scaled down grows the rows in place, on an engine that takes it, and reopens nothing', async () => {
  // Shrunk a thousand times, the core node both cells hang under brings the one 5 km off to 5 m:
  // both are within the grids' 100 m, three nodes on rows sized for the near cell's two. An engine
  // that grows no buffer, or refuses this growth, is left with its rows as they were and asks for
  // a reopen.
  for (const grows of [true, false, undefined]) {
    const { cells, links, core, bytes } = world(0, 0, [], [100, 100, 100])
    const { port, held, outgrown, updates, rebind } = io(bytes)
    let grownAt: number | undefined
    const grown: [PlacementRows, PlacementRows][] = [],
      asked: [number, number][] = []
    if (grows !== undefined)
      port.grow = {
        growsInPlace: (from, capacity) => (asked.push([from.length, capacity]), grows),
        growPlacements: (from, to) => (
          grown.push([from, to]),
          rebind(from, to),
          void (grownAt ??= updates.length)
        ),
      }
    ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
    await opened(cells, bytes)
    const before = links.map((link) => link.placements!)
    core.scale.set(1e-3, 1e-3, 1e-3)
    await settled(cells, [0, 0, 0], port, noBudget)
    const { held: placed, waiting } = cells.stats()
    assert.deepEqual([placed, waiting, outgrown.count], grows ? [2, 0, 0] : [1, 1, 1])
    if (grows !== undefined) assert.deepEqual(asked, [[2, 4]], 'both buffers asked at once')
    if (!grows) {
      assert.deepEqual(grown, [], 'no buffer replaced: the session reads the ones it holds')
      assert.ok(links.every((link, at) => link.placements === before[at]))
      // The session opened again sizes the rows for the view and places the far cell.
      await opened(cells, bytes)
      assert.deepEqual([cells.stats().held, cells.stats().rows], [2, 4])
      continue
    }
    const after = links.map((link) => link.placements!)
    assert.deepEqual(
      grown,
      [0, 1].map((at) => [before[at], after[at]]),
    )
    // The engine is told of the grown buffers only: no row of the replaced ones is read again.
    assert.ok(updates.slice(grownAt).every(([rows]) => after.includes(rows)))
    assert.ok(after.every((rows) => rows.live.reduce((a, b) => a + b, 0) === 3))
  }
})

test('rows that hold every cell never ask for a reopen: sized so, or with no owner', async () => {
  for (const owned of [true, false]) {
    const { cells, bytes } = world()
    const { port, held, outgrown } = io(bytes)
    await opened(cells, bytes, owned, between)
    ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
    await settled(cells, between, port, noBudget)
    assert.deepEqual([cells.stats().held, cells.stats().waiting, outgrown.count], [2, 0, 0])
  }
})

test('a world that poses the scene root reads the cells its camera sees there', async () => {
  // The far cell stands at the world's origin once the root is moved back 5 km and shrunk ten
  // times: a camera there asks for it, and not for the near cell, now 500 m away.
  const { cells, root, bytes } = await sizedWhole(world())
  root.position.set(-500, 0, 0)
  root.scale.set(0.1, 0.1, 0.1)
  const { port, asked } = io(bytes)
  await settled(cells, [2, 0, 0], port, noBudget)
  assert.deepEqual([...new Set(asked)], [cellUrl('far.json')])
})

test('a view moving within a step keeps its wishes, one past it plans them again', async () => {
  // Ranges of 2 802 m: the far cell, 5 000 m away, is wished from x = 2 198 on, the squares of the
  // update (4 m wide) cut it at 2 196 and 2 200: 2 199 and 2 197 lie in one.
  const { cells, bytes } = await sizedWhole(world(0, null, [], [2802, 2802, 5600]))
  const { port, held } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  const ahead = [0, 0, -1]
  const frame = (x: number) => cells.frame([x, 0, 0], port, noBudget, ahead)
  await settled(cells, [2199, 0, 0], port, noBudget, ahead)
  // The first frame left no work, the next keeps the square: the update skips from there on.
  frame(2199)
  frame(2199)
  assert.equal(cells.stats().held, 2, 'both cells are placed')
  frame(2197)
  assert.equal(cells.stats().held, 2, 'the far cell, out of range by 1 m, stays: the square holds')
  frame(2193)
  assert.equal(cells.stats().held, 1, 'the square left: the far cell leaves')
})

test('a view that asks to load only tells the cut its cells are not activated, and loads them as ever', async () => {
  for (const state of ['activated', 'loaded'] as const) {
    const { cells, bytes } = await sizedWhole(world())
    const { port, held } = io(bytes)
    const told: boolean[] = []
    port.world = {
      activated: (on: boolean) => void told.push(on),
      hlodEnabled() {},
      blockingLoad() {},
      fileShown: () => false,
    } as never
    port.streaming = resolveWorldStreaming({ worldStreamingTargetState: state })
    ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
    await settled(cells, between, port, noBudget)
    cells.frame(between, port, noBudget)
    assert.equal(cells.stats().held, 2, `${state}: both cells are placed`)
    assert.deepEqual([...new Set(told)], [state === 'activated'], state)
  }
})

test('the update is keyed on the camera in the world: a scene shrunk a hundred times still skips', async () => {
  // The root at a hundredth: a unit of the cells' frame is a centimetre of the world. The far cell,
  // 5 000 units off, is wished from 21.98 m of the world on (ranges of 2 802 units); the squares of
  // the update are 4 m of the world wide, 20 to 24 holding 22.5 and 21.9.
  const { cells, root, bytes } = await sizedWhole(world(0, null, [], [2802, 2802, 5600]))
  root.scale.set(0.01, 0.01, 0.01)
  const { port, held } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  const ahead = [0, 0, -1]
  const frame = (x: number) => cells.frame([x, 0, 0], port, noBudget, ahead)
  await settled(cells, [22.5, 0, 0], port, noBudget, ahead)
  frame(22.5)
  frame(22.5)
  assert.equal(cells.stats().held, 2, 'both cells are placed')
  frame(21.9)
  assert.equal(cells.stats().held, 2, 'out of range by 0.08 m, in the square: the far cell stays')
  frame(19)
  assert.equal(cells.stats().held, 1, 'the square left: the far cell leaves')
})

test('a cell placed in the last frame before a still view gets its HLOD word at the next frame', async () => {
  // The main grid reaches 2 000, the HLOD 0 grid 4 000: from x = 1 500 the far cell, 3 500 away, is
  // placed for its HLOD 0 cell and draws as its actor; the near one draws its source meshes.
  const { cells, links, bytes } = await sizedWhole(world(0, null, [], [2000, 4000, 8000]))
  const { port, held } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  const ahead = [0, 0, -1]
  await settled(cells, [1500, 0, 0], port, noBudget, ahead)
  cells.frame([1500, 0, 0], port, noBudget, ahead)
  assert.equal(cells.stats().held, 2, 'both cells are placed')
  const rows = links[0].placements!
  const proxies = new Map<number, boolean[]>()
  for (let index = 0; index < 3; index++) {
    const at = rowCell(rows, index)!
    proxies.set(at.cell, [...(proxies.get(at.cell) ?? []), at.proxy])
  }
  assert.deepEqual([...proxies.values()].sort(), [[false, false], [true]])
})
