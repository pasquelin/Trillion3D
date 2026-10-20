import assert from 'node:assert/strict'
import { test } from 'node:test'
import { machineFrom } from './machine.ts'
import { CHAIN, STREAM_BYTES, THREAD_GROUPS, GROUP_THREADS } from './machineKernels.ts'
import { TAP_GRID, TAPS } from './machineWork.ts'

test('a machine reads its rates from the kernels’ times', () => {
  // 128 MiB read in 1 ms is 134 GB/s; 64 empty passes in 0.64 ms are 0.01 ms each; a dependent chain
  // 0.064 ms slower than an independent one is 0.001 ms of barrier a dispatch.
  const m = machineFrom(
    'test gpu',
    {
      read: 1,
      write: 2,
      textureRead: 1,
      textureWrite: 1,
      attachment: 1,
      threads: 0.5,
      passes: 0.64,
      independent: 0.64,
      dependent: 0.704,
      texelLoad: 1,
      texelFilter: 2,
      alu: 1,
      shared: 1,
      attachments4: 1,
      fragments: 1,
      triangles: 1,
    },
    '2026-10-08T00:00:00Z',
  )
  assert.ok(Math.abs(m.readGBs - STREAM_BYTES / 1e6) < 1e-9)
  assert.equal(m.writeGBs, m.readGBs / 2)
  assert.equal(m.threadsPerMs, (THREAD_GROUPS * GROUP_THREADS) / 0.5)
  assert.ok(Math.abs(m.passMs - 0.64 / CHAIN) < 1e-12)
  assert.ok(Math.abs(m.barrierMs - 0.001) < 1e-12)
  // 2048² threads of 16 taps in 1 ms: 67 Gtexel/s; filtered in 2 ms, half.
  assert.equal(m.texelLoadG, (TAP_GRID ** 2 * TAPS) / 1e6)
  assert.equal(m.texelFilterG, m.texelLoadG / 2)
  assert.equal(
    machineFrom(
      'x',
      {
        ...{
          read: 1,
          write: 1,
          textureRead: 1,
          textureWrite: 1,
          attachment: 1,
          threads: 1,
          passes: 1,
          independent: 2,
          dependent: 1,
          texelLoad: 1,
          texelFilter: 2,
          alu: 1,
          shared: 1,
          attachments4: 1,
          fragments: 1,
          triangles: 1,
        },
      },
      '',
    ).barrierMs,
    0,
    'never a negative barrier',
  )
})

test('a kernel that timed nothing is no machine', () => {
  const ok = {
    read: 1,
    write: 1,
    textureRead: 1,
    textureWrite: 1,
    attachment: 1,
    threads: 1,
    passes: 1,
    independent: 1,
    dependent: 2,
    texelLoad: 1,
    texelFilter: 2,
    alu: 1,
    shared: 1,
    attachments4: 1,
    fragments: 1,
    triangles: 1,
  }
  assert.throws(() => machineFrom('x', { ...ok, read: 0 }, ''), /BENCH_MACHINE.*read/)
  assert.throws(() => machineFrom('x', { ...ok, threads: Number.NaN }, ''), /BENCH_MACHINE/)
})
