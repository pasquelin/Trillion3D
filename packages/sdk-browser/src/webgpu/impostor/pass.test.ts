// The card pass's groups go through the engine's one bind-group cache: the tile group is made
// again only when an atlas's views or table, or the sampler, move, the identifiers' group only when
// their view does. A card buffer outgrown is retired, never destroyed under the image's commands.
// Fails on the old pass: it destroyed the outgrown buffer at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { prepareImpostorPipelines } from './pipelines.ts'
import { createImpostorPass } from './pass.ts'
import type { WebgpuTileAtlas } from '../tile/atlas.ts'

const atlas = (kind: string) =>
  ({
    views: [0, 1, 2].map((lane) => ({ label: `${kind} ${lane}` })),
    pages: { buffer: { label: `${kind} pages` } },
  }) as unknown as WebgpuTileAtlas

test('the card pass makes a group again only when what it binds moves', async () => {
  const gpu = fakeDevice()
  assert.ok(await prepareImpostorPipelines(gpu.device, () => {}))
  const pass = createImpostorPass(gpu.device)
  const sources = { color: atlas('color'), data: atlas('data'), sampler: {} as GPUSampler }
  const made = () => gpu.bindGroups.length
  const first = pass.tilesGroup(sources),
    groups = made()
  assert.equal(pass.tilesGroup(sources), first, 'still sources: the same group')
  assert.equal(made(), groups)
  const regrown = { ...sources, data: { ...sources.data, pages: { buffer: {} } } }
  assert.notEqual(pass.tilesGroup(regrown as never), first, 'a table regrown: a group again')
  const view = {} as GPUTextureView
  const ids = pass.idsGroup(view)
  assert.equal(pass.idsGroup(view), ids)
  assert.notEqual(pass.idsGroup({} as GPUTextureView), ids)
})

test('an outgrown card buffer is retired until the frame is submitted', async () => {
  const gpu = fakeDevice()
  assert.ok(await prepareImpostorPipelines(gpu.device, () => {}))
  const pass = createImpostorPass(gpu.device)
  const old = pass.imageGroup(1).buffer
  pass.imageGroup(4096)
  assert.ok(!gpu.destroyed.includes(old), 'still named by this image')
  destroyRetired(gpu.device)
  assert.ok(gpu.destroyed.includes(old), 'destroyed after the submit')
})
