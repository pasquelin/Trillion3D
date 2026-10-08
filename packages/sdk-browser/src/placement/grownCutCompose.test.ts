// A link a parent makes while a grown cut is being made reaches the new one too: its tree reads
// the one compose state (`composedRoot`) at its first cut, so the child its parent poses on the
// GPU is never culled at its last CPU pose; nothing is replayed at the swap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placedSession } from './webgpuGrowth.fixture.ts'
import { growthOf } from './webgpuGrowth.ts'
import { composedRoot, composeWebgpuPlacements } from './gpuCompose.ts'
import { noBudget, settled } from '../partition/cells.fixture.ts'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test('a link made while the grown cut is made opens its group in that cut once swapped in', async () => {
  const session = await placedSession(5)
  const { rt, cells, core, io, draw } = session
  try {
    core.scale.set(1e-3, 1e-3, 1e-3)
    await settled(cells, [0, 0, 0], 100, io, noBudget)
    await draw()
    await growthOf(rt)?.making
    const ready = growthOf(rt)!.ready!
    assert.ok(!ready.inPlace, 'a cut made beside the running one')
    // The link, made on the running cut while the new one waits.
    const rank = rt.layout.selectionRoots.findIndex((root) => root.placement && !root.parked),
      { rows, index } = rt.layout.selectionRoots[rank].placement!
    const link = { rows, index, local: IDENTITY }
    assert.ok(composeWebgpuPlacements(rt, {}, IDENTITY, [link], true))
    const told: number[] = []
    ready.cut.composedPlacement = (w) => void told.push(w)
    await draw()
    assert.equal(rt.run.gpuSelection, ready.cut, 'swapped in')
    assert.ok(composedRoot(rt, rank), 'the compose state its tree reads holds the link')
    assert.deepEqual(told, [], 'nothing replayed at the swap')
  } finally {
    session.dispose()
  }
})
