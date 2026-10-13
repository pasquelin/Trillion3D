// The GPU eviction rank against its CPU oracle, on generated frames: the real cut on Dawn stamps
// what it draws and asks for at the host's frame, raises the groups replacing them up to the
// roots, and lists the pool's pages oldest use first, finer first among equal ages, none any view
// used this frame or the one before (`gpu/dag/evict.ts`). The oracle replays the same rules on the
// same readbacks: the same pages listed, in an order of non-increasing rank, with the same old head.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./evictionRankPage.ts').runEvictionRank>>

test('the GPU lists what the oracle lists, oldest use first, never a page in use', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'evictionRankPage.ts'),
    'evictionRank',
    'runEvictionRank',
  )) as Reading
  assertSoundProof(reading)
  const frames = 'frames' in reading ? (reading.frames ?? []) : []
  console.log(
    JSON.stringify({
      adapter: 'adapter' in reading ? reading.adapter : null,
      frames: frames.map(({ frame, gpu, gpuOld, read }) => ({
        frame,
        listed: gpu.length,
        old: gpuOld,
        read,
      })),
    }),
  )
  assert.equal(frames.length, 48)
  assert.ok(
    frames.some((f) => f.gpu.length > 0 && f.gpuOld > 0 && f.gpuOld < f.gpu.length),
    'the generated frames reach queues with an old head and recent pages behind it',
  )
  for (const f of frames) {
    assert.ok(!f.truncated, `frame ${f.frame}: the readback holds the whole cut`)
    assert.ok(f.read > 0, `frame ${f.frame}: the cut reads pages`)
    assert.deepEqual(
      [...f.gpu].sort((a, b) => a - b),
      [...f.oracle].sort((a, b) => a - b),
      `frame ${f.frame}: the same pages listed`,
    )
    for (let i = 1; i < f.ranks.length; i++)
      assert.ok(f.ranks[i - 1] >= f.ranks[i], `frame ${f.frame}: rank order at ${i}`)
    assert.equal(f.gpuOld, f.oracleOld, `frame ${f.frame}: the old head`)
  }
})
