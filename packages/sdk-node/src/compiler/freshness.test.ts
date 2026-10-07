import test from 'node:test'
import assert from 'node:assert/strict'
import { rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { currentCompilerExecutable } from './executable.mts'
import { sourceNewerThan } from './freshness.mts'
import { crate } from './freshness.fixture.ts'

// Behaviour: the checkout's build is launched as long as nothing it is built from moved since.
test('a compiler built after its sources is the one a cook runs', async () => {
  const { root, binary } = await crate(2_000, 1_000)
  try {
    assert.equal(currentCompilerExecutable(undefined, {}, { crate: root }), binary)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Behaviour: a crate source edited after the build refuses the cook by name, with the file and
// the command that rebuilds — never a product under the previous build's key.
test('editing a crate source refuses the cook until the compiler is rebuilt', async () => {
  const { root, binary, stage } = await crate(2_000, 1_000)
  try {
    await utimes(stage, 3_000, 3_000)
    assert.throws(
      () => currentCompilerExecutable(undefined, {}, { crate: root }),
      (error: Error) =>
        error.message.includes(`COMPILER_STALE:`) &&
        error.message.includes(`${binary} is older than ${stage}`) &&
        error.message.includes('pnpm run build:native'),
    )
    await utimes(binary, 4_000, 4_000)
    assert.equal(currentCompilerExecutable(undefined, {}, { crate: root }), binary)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Behaviour: a binary the operator names is trusted whatever the crate says, and announced once.
test('a binary named by TRILLION3D_COMPILER_BIN is trusted and announced once', async (t) => {
  const { root } = await crate(1_000, 2_000)
  const written: unknown[] = []
  t.mock.method(process.stderr, 'write', (chunk: unknown) => written.push(chunk) > 0)
  try {
    const environment = { TRILLION3D_COMPILER_BIN: '/operator/compiler' }
    assert.equal(
      currentCompilerExecutable(undefined, environment, { crate: root }),
      '/operator/compiler',
    )
    assert.equal(
      currentCompilerExecutable(undefined, environment, { crate: root }),
      '/operator/compiler',
    )
    assert.equal(
      currentCompilerExecutable('/caller/compiler', {}, { crate: root }),
      '/caller/compiler',
    )
  } finally {
    t.mock.restoreAll()
    await rm(root, { recursive: true, force: true })
  }
  assert.deepEqual(written, ['compiler: /operator/compiler (TRILLION3D_COMPILER_BIN)\n'])
})

// Behaviour: with nothing to compare — no binary yet, or a binary without its crate beside it,
// as an installed package ships it — there is no refusal; a missing binary is reported at launch.
test('no binary or no crate sources is not a refusal', async () => {
  const { root, binary } = await crate(1_000, 2_000)
  try {
    assert.equal(sourceNewerThan(binary, join(root, 'absent')), null)
    await rm(binary)
    assert.equal(sourceNewerThan(binary, root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
