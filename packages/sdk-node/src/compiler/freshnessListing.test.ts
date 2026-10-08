import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { sourceNewerThan } from './freshness.mts'
import { linkedCrates, stubBinary } from './freshness.fixture.ts'

// Behaviour: test code is not built into the compiler: a test, the golden harness or a
// `#[cfg(test)]` module edited after the build leaves it current, as it leaves its hash — the
// binary's own list says so, asked once for as many launches as its build serves, in this process
// and in a new one, which reads the answer kept beside the binary.
test('editing test code leaves the compiler current, the binary asked once per build', async () => {
  const { packages, root, binary } = await linkedCrates()
  const { asked, inputs } = stubBinary()
  try {
    for (const test of ['src/lib_tests.rs', 'src/golden/value.rs', 'src/screen.rs']) {
      await utimes(join(packages, 'math/rust', test), 3_000, 3_000)
      await utimes(join(root, test), 3_000, 3_000)
    }
    assert.equal(sourceNewerThan(binary, root, inputs), null)
    assert.equal(sourceNewerThan(binary, root, inputs), null)
    assert.deepEqual(asked, [binary])
    const another = (await import(`./freshness.mts?process=${Date.now()}`)) as {
      sourceNewerThan: typeof sourceNewerThan
    }
    assert.equal(another.sourceNewerThan(binary, root, inputs), null)
    assert.deepEqual(asked, [binary])
    await utimes(binary, 2_500, 2_500)
    assert.equal(sourceNewerThan(binary, root, inputs), null)
    assert.deepEqual(asked, [binary, binary])
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})

// Behaviour: a binary that did not answer (timeout, signal) is not asked again by this process for
// the same build, and nothing of the failure is kept on disk: a new process asks again.
test('a failed ask is remembered in memory for the process and the build, not on disk', async () => {
  const { packages, root, binary } = await linkedCrates()
  let asked = 0
  const failing = () => {
    asked++
    return undefined
  }
  try {
    sourceNewerThan(binary, root, failing)
    sourceNewerThan(binary, root, failing)
    assert.equal(asked, 1)
    const another = (await import(`./freshness.mts?failure=${Date.now()}`)) as {
      sourceNewerThan: typeof sourceNewerThan
    }
    another.sourceNewerThan(binary, root, failing)
    assert.equal(asked, 2)
    await utimes(binary, 2_500, 2_500)
    sourceNewerThan(binary, root, failing)
    assert.equal(asked, 3)
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})

// Behaviour: only a definite "flag unknown" is kept on disk; a timeout or a signal is kept in
// memory alone, for this build.
test('an unanswered ask is not kept, an unknown flag is', async () => {
  const { packages, root, binary } = await linkedCrates()
  let asked = 0
  try {
    sourceNewerThan(binary, root, () => (asked++, undefined))
    sourceNewerThan(binary, root, () => (asked++, undefined))
    assert.equal(asked, 1)
    assert.equal(existsSync(`${binary}.build-inputs.json`), false)
    await utimes(binary, 2_500, 2_500)
    sourceNewerThan(binary, root, () => (asked++, null))
    assert.equal(asked, 2)
    assert.equal(existsSync(`${binary}.build-inputs.json`), true)
    sourceNewerThan(binary, root, () => (asked++, null))
    assert.equal(asked, 2)
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})
