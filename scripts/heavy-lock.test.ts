import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireHeavyLock, heavyLockPath, heavyStep, takeOver } from './heavy-lock.ts'

const lockModule = join(import.meta.dirname, 'heavy-lock.ts')

// The throwaway repository's own commit identity, never the user's configuration.
const identity = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

/** A checkout and one linked worktree of it, in a temporary folder. */
function checkouts(): { main: string; worktree: string; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  const main = join(root, 'main')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, ...identity } })
  }
  git('init', '-q', main)
  git('-C', main, 'commit', '-q', '--allow-empty', '-m', 'start')
  git('-C', main, 'worktree', 'add', '-q', join(main, '.worktrees', 'one'))
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

test('a lock whose process is dead is taken over', () => {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  try {
    const path = join(root, 'heavy-step.lock')
    writeFileSync(path, JSON.stringify({ pid: deadPid(), step: 'build', cwd: root }))
    const release = acquireHeavyLock(path, 'test', 10)
    assert.ok(existsSync(path))
    release()
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(root, { recursive: true })
  }
})

test("a takeover removes only the dead holder's lock, and puts back a lock taken meanwhile", () => {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  try {
    const path = join(root, 'heavy-step.lock')
    const live = JSON.stringify({ pid: process.pid, step: 'build', cwd: root })
    writeFileSync(path, live)
    takeOver(path, deadPid())
    assert.equal(readFileSync(path, 'utf8'), live, 'another waiter was granted it first')
    const dead = deadPid()
    writeFileSync(path, JSON.stringify({ pid: dead, step: 'build', cwd: root }))
    takeOver(path, dead)
    assert.equal(existsSync(path), false)
    takeOver(path, dead)
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('waiters that take a dead lock over together still run one after the other', async () => {
  const root = mkdtempSync(join(tmpdir(), 'heavy-lock-'))
  try {
    const path = join(root, 'heavy-step.lock')
    writeFileSync(path, JSON.stringify({ pid: deadPid(), step: 'build', cwd: root }))
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
    const runs = (await Promise.all([waiter(), waiter(), waiter()])).sort(
      (a, b) => a.start - b.start,
    )
    for (let i = 1; i < runs.length; i++)
      assert.ok(runs[i].start >= runs[i - 1].end, `${JSON.stringify(runs)} overlap`)
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('the CI takes no lock', () => {
  const env: NodeJS.ProcessEnv = { CI: 'true' }
  assert.equal(
    heavyStep('test', () => env.TRILLION3D_HEAVY_LOCK, env),
    undefined,
  )
})
