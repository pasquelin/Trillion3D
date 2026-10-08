// A growth names its roots — every one placed by rows — to the next image, which sends their worlds
// alone: no host walk, whatever the scene's size. On generated growths of 1 to 500 roots behind 10⁴.
import test from 'node:test'
import assert from 'node:assert/strict'
import { announceGrowth } from './growthAnnounce.ts'
import { createSortedKeys } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

const runtime = () => {
  const said: string[] = []
  const rt = {
    run: {
      movedWorlds: createSortedKeys(),
      gate: {
        sceneChanged: () => void said.push('walk'),
        engineMovedInPlace: () => void said.push('moved'),
      },
    },
  } as unknown as WebgpuPagesRuntime
  return { rt, said }
}

test('roots a growth brings are named, never walked', () => {
  for (const count of [1, 37, 500]) {
    const { rt, said } = runtime()
    announceGrowth(
      rt,
      Array.from({ length: count }, () => ({ placement: {} })),
      10_000,
    )
    assert.deepEqual(said, ['moved'], `${count} roots`)
    const { list, count: named } = rt.run.movedWorlds.listed
    assert.equal(named, count)
    assert.deepEqual([list[0], list[named - 1]], [10_000, 10_000 + count - 1])
  }
})
