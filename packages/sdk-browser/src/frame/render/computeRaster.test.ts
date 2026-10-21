import test from 'node:test'
import assert from 'node:assert/strict'
import { MODE_DEPTH, MODE_ID, rasterEntry } from '../../visibility/raster/contract.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import {
  quadScene,
  camera,
  disposeQuadRun,
  flushedGpuScene,
} from '../backend/testScenes.fixture.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

// Every image splits its clusters between the two rasters and writes one visibility buffer: the
// main pass's binning first, then its depth — hardware slots, software lists —, the post pass's
// when the cut runs one, then the identifiers, the hardware slots drawn again for them; the
// pyramid's level zero after each pass's depth and the closed image are full-screen resolves of
// the buffer (`resolve.ts`).
test('every image bins its clusters, writes each pass’s depth, then the identifiers', async () => {
  installGpuGlobals()
  const fixture = quadScene()
  const { draws, dispatches, buffers, packed, backend } = await flushedGpuScene(fixture)
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  const at = (entry: string) => dispatchedEntries(dispatches).indexOf(entry)
  const bin = at('bin'),
    depth = at(rasterEntry('fine', MODE_DEPTH)),
    ids = at(rasterEntry('fine', MODE_ID))
  assert.ok(bin >= 0 && depth > bin && ids > depth)
  assert.ok(draws.some((draw) => draw.indirect))
  const resolves = draws
    .filter((draw) => draw.entryPoint === 'fullscreen')
    .map((draw) => draw.pipeline.fragment?.entryPoint)
    .filter((entry) => entry === 'depthLevel' || entry === 'resolved')
  // Level zero once a pass, the image closed once.
  assert.equal(resolves.at(-1), 'resolved')
  assert.ok(resolves.length >= 2 && resolves.slice(0, -1).every((entry) => entry === 'depthLevel'))
  disposeQuadRun(backend, fixture)
})
