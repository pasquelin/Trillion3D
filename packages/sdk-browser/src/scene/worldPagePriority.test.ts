// A world page is read at its asker's priority down to its bundle's read in the session's queue:
// a prefetch, a sibling a read landed or a far cell's page never jumps the view's own pages.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { createWorldBundles } from './worldBundles.ts'
import { worldPageServer, worldRootsPageAddress } from './worldPageServe.ts'
import { PRIORITY_PREFETCH } from '../streaming/priority.ts'
import type { PageQueue } from '../streaming/types.ts'

test("a world page's bundle is read at the priority its asker gave", async () => {
  const { table, bin } = worldRootsFixture()
  const priorities: (number | undefined)[] = []
  const queue = {
    signal: new AbortController().signal,
    admit: () => {},
    readBytes: async (url: string, _signal: AbortSignal, priority?: number) => {
      priorities.push(priority)
      const { offset, bytes } = table.bundles[Number(url.slice(url.lastIndexOf('#') + 1))]
      return bin.slice(offset, offset + bytes)
    },
  } as unknown as PageQueue
  const bundles = createWorldBundles(table, 'world-roots.bin', [[]])
  bundles.bind(queue)
  const server = worldPageServer(table, bundles.pages)
  const page = await server.read(
    worldRootsPageAddress('world-roots.bin', 2, 0),
    undefined,
    PRIORITY_PREFETCH,
  )
  assert.ok(page.byteLength > 0)
  assert.deepEqual(priorities, [PRIORITY_PREFETCH])
})
