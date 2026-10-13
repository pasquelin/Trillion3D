import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acquireHeavyLock, heavyLockPath, heavyStep, takeOver } from './heavy-lock.ts'
import { git } from './git-paths.ts'

const lockModule = join(import.meta.dirname, 'heavy-lock.ts')

/** A checkout and one linked worktree of it, in a temporary folder; its commit carries the throwaway
 *  repository's own identity, never the user's configuration. */
function checkouts(): { main: string; worktree: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  const main = join(root, 'main')
  git(root, 'init', '-q', main)
  git(
    main,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'start',
  )
  git(main, 'worktree', 'add', '-q', join(main, '.worktrees', 'one'))
  return {
    main,
    worktree: join(main, '.worktrees', 'one'),
    remove: () => rmSync(root, { recursive: true }),
  }
}

/** Runs a 300 ms heavy step in `cwd`, as a local run; resolves with its start, end and niceness. */
function step(cwd: string): Promise<{ start: number; end: number; nice: number }> {
  const code = `import { heavyStep } from ${JSON.stringify(lockModule)};
import { getPriority } from 'node:os';
heavyStep('test', () => {
  const start = Date.now();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  console.log(JSON.stringify({ start, end: Date.now(), nice: getPriority() }));
});`
  const env = { ...process.env }
  delete env.CI
  delete env.TRILLION3D_HEAVY_LOCK
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd, env })
  let out = ''
  child.stdout.on('data', (chunk) => (out += chunk))
  return new Promise((done, fail) =>
    child.on('close', (status) =>
      status ? fail(new Error(`exit ${status}`)) : done(JSON.parse(out.trim().split('\n').at(-1)!)),
    ),
  )
}

test('two heavy steps started from two worktrees run one after the other, at low priority', async () => {
  const { main, worktree, remove } = checkouts()
  try {
    assert.equal(heavyLockPath(worktree), heavyLockPath(main))
    const [first, second] = (await Promise.all([step(main), step(worktree)])).sort(
      (a, b) => a.start - b.start,
    )
    assert.ok(second.start >= first.end, `${JSON.stringify([first, second])} overlap`)
    assert.ok(first.nice >= 10 && second.nice >= 10)
    assert.equal(existsSync(heavyLockPath(main)!), false, 'the lock is released')
  } finally {
    remove()
  }
})

/** The pid of a process that has exited. */
const deadPid = (): number =>
  Number(
    spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout,
  )

/** A lock path in a throwaway folder removed when test `t` ends, its lock held by `pid`. */
function heldLock(t: TestContext, pid: number) {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  t.after(() => rmSync(root, { recursive: true }))
  const path = join(root, 'heavy-step.lock')
  hold(path, pid)
  return path
}

/** Writes the lock at `path` as held by `pid`, for a build step run in its folder. */
const hold = (path: string, pid: number) =>
  writeFileSync(path, JSON.stringify({ pid, step: 'build', cwd: dirname(path) }))

test('a lock whose process is dead is taken over', (t) => {
  const path = heldLock(t, deadPid())
  const release = acquireHeavyLock(path, 'test', 10)
  assert.ok(existsSync(path))
  release()
  assert.equal(existsSync(path), false)
})

test("a takeover removes only the dead holder's lock, and leaves a live one in place", (t) => {
  const path = heldLock(t, process.pid)
  const live = readFileSync(path, 'utf8')
  takeOver(path, deadPid())
  assert.equal(readFileSync(path, 'utf8'), live, 'another waiter was granted it first')
  const dead = deadPid()
  hold(path, dead)
  takeOver(path, dead)
  assert.equal(existsSync(path), false)
  takeOver(path, dead)
})

test('waiters that take a dead lock over together still run one after the other', async (t) => {
  const path = heldLock(t, deadPid())
  const code = `import { acquireHeavyLock } from ${JSON.stringify(lockModule)};
const release = acquireHeavyLock(${JSON.stringify(path)}, 'test', 1);
const start = Date.now();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
console.log(JSON.stringify({ start, end: Date.now() }));
release();`
  const waiter = (): Promise<{ start: number; end: number }> =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code])
      let out = ''
      child.stdout.on('data', (chunk) => (out += chunk))
      child.on('close', (status) =>
        status
          ? fail(new Error(`exit ${status}`))
          : done(JSON.parse(out.trim().split('\n').at(-1)!)),
      )
    })
  const runs = (await Promise.all([waiter(), waiter(), waiter()])).sort((a, b) => a.start - b.start)
  for (let i = 1; i < runs.length; i++)
    assert.ok(runs[i].start >= runs[i - 1].end, `${JSON.stringify(runs)} overlap`)
})

test('the CI takes no lock', () => {
  const env: NodeJS.ProcessEnv = { CI: 'true' }
  assert.equal(
    heavyStep('test', () => env.TRILLION3D_HEAVY_LOCK, env),
    undefined,
  )
})
