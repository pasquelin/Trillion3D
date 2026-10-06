import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { LOCK_OWNER, benchAlive, lockHolder, takeBenchLock } from './lock.ts'

const scratch = () => join(mkdtempSync(join(tmpdir(), 'bench-lock-')), 'gpu-bench.lock')

test('a bench takes the free lock, names itself in it, and leaves it free once released', () => {
  const path = scratch()
  const release = takeBenchLock('v06', path)
  assert.equal(lockHolder(path)?.pid, process.pid)
  assert.equal(lockHolder(path)?.what, 'v06')
  release()
  assert.equal(existsSync(path), false)
})

test('a second bench is refused while the first one runs, by the first one’s name', async () => {
  const path = scratch()
  // A live process whose command names the bench, holding the lock.
  const holder = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 20000)', 'bench/dawn/run.ts'],
    {
      stdio: 'ignore',
    },
  )
  try {
    writeFileSync(path, JSON.stringify({ pid: holder.pid, since: 'now', what: 'pebbles' }))
    assert.equal(benchAlive(holder.pid!), true)
    assert.throws(
      () => takeBenchLock('v06', path),
      /GPU_BENCH_BUSY: bench pid \d+ measures pebbles/,
    )
  } finally {
    holder.kill()
  }
})

test('the lock of a bench that died is taken over', () => {
  const path = scratch()
  writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 17, since: 'yesterday', what: 'crashed' }))
  const release = takeBenchLock('v06', path)
  assert.equal(lockHolder(path)?.pid, process.pid)
  release()
})

test('a live process that is not a bench does not hold the lock', () => {
  const path = scratch()
  // The dead bench's pid, given again to another program.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' })
  try {
    writeFileSync(path, JSON.stringify({ pid: other.pid, since: 'now', what: 'reused pid' }))
    const release = takeBenchLock('v06', path)
    assert.equal(lockHolder(path)?.pid, process.pid)
    release()
  } finally {
    other.kill()
  }
})

test('a child of the run holding the lock shares it; a child of another run is refused', () => {
  const path = scratch()
  writeFileSync(path, JSON.stringify({ pid: 4242, since: 'now', what: 'ab' }))
  const saved = process.env[LOCK_OWNER]
  try {
    process.env[LOCK_OWNER] = '4242'
    assert.doesNotThrow(() => takeBenchLock('v06', path)())
    process.env[LOCK_OWNER] = '4343'
    assert.throws(() => takeBenchLock('v06', path), /GPU_BENCH_LOCK/)
  } finally {
    if (saved === undefined) delete process.env[LOCK_OWNER]
    else process.env[LOCK_OWNER] = saved
  }
})

test('a lock left unreadable is taken over, and taking it leaves no file of its own beside it', () => {
  const path = scratch()
  writeFileSync(path, '')
  const release = takeBenchLock('v06', path)
  assert.equal(lockHolder(path)?.pid, process.pid)
  assert.deepEqual(readdirSync(dirname(path)), ['gpu-bench.lock'])
  release()
  assert.deepEqual(readdirSync(dirname(path)), [])
})

test('a GPU proof run on its own is a live bench', () => {
  const proof = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 20000)', 'tests/gpu/frame/fallback-blend.gpu.ts'],
    { stdio: 'ignore' },
  )
  try {
    assert.equal(benchAlive(proof.pid!), true)
  } finally {
    proof.kill()
  }
})

test('a run whose lock another process took says so and fails, and leaves that lock in place', () => {
  const path = scratch()
  const release = takeBenchLock('v06', path)
  writeFileSync(path, JSON.stringify({ pid: 4242, since: 'now', what: 'other' }))
  const saved = process.exitCode
  try {
    release()
    assert.equal(process.exitCode, 1)
    assert.equal(lockHolder(path)?.pid, 4242)
  } finally {
    process.exitCode = saved
  }
})
