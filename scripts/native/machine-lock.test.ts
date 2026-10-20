import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockHolder, processAlive, tryLock } from './machine-lock.ts'

/** A lock path in a throwaway folder removed when test `t` ends. */
function lockPath(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'machine-lock-'))
  t.after(() => rmSync(root, { recursive: true }))
  return join(root, 'machine.lock')
}

// Behaviour: a live holder's lock is never moved nor rewritten; the taker is told who holds it.
test("a live holder's lock is left in place and named", (t) => {
  const path = lockPath(t)
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' })
  t.after(() => live.kill())
  writeFileSync(path, JSON.stringify({ pid: live.pid, step: 'build' }))
  const before = readFileSync(path, 'utf8')
  assert.deepEqual(tryLock(path, { pid: process.pid, step: 'test' }, processAlive), {
    holder: { pid: live.pid, step: 'build' },
  })
  assert.equal(readFileSync(path, 'utf8'), before)
})

// Behaviour: a dead holder's lock is taken over; the release frees it once and says so.
test("a dead holder's lock is taken, and released by its new holder alone", (t) => {
  const path = lockPath(t)
  writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 17, step: 'crashed' }))
  const taken = tryLock(path, { pid: process.pid, step: 'test' }, processAlive)
  assert.ok(taken && 'release' in taken)
  assert.equal(lockHolder(path)?.pid, process.pid)
  writeFileSync(path, JSON.stringify({ pid: 4242, step: 'other' }))
  assert.equal(taken.release(), false)
  assert.equal(lockHolder(path)?.pid, 4242)
  rmSync(path)
  assert.equal(existsSync(path), false)
})
