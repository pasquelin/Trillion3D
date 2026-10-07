import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentCompilerExecutable } from './executable.mts'
import { sourceNewerThan } from './freshness.mts'
import { compilerFileName } from './platform.mts'

const binaryName = compilerFileName(process.platform)

/** A crate built at `builtAt` from sources dated `editedAt`: seconds since the epoch. */
async function crate(builtAt: number, editedAt: number) {
  const root = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'))
  await mkdir(join(root, 'src/nested'), { recursive: true })
  await mkdir(join(root, 'target/release'), { recursive: true })
  const binary = join(root, 'target/release', binaryName)
  const sources = ['Cargo.toml', 'src/lib.rs', 'src/nested/stage.rs'].map((file) =>
    join(root, file),
  )
  for (const file of sources) {
    await writeFile(file, '')
    await utimes(file, editedAt, editedAt)
  }
  await writeFile(binary, '')
  await utimes(binary, builtAt, builtAt)
  return { root, binary, stage: sources[2] }
}

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

// Behaviour: the crates the compiler links — the page codec, and the maths through it — are built
// into it: an edit in either is a stale build — their folders and the edited file both from what
// the binary prints of its build, no manifest read.
const CRATES = ['asset-compiler-rust', 'page-codec-wasm', 'math/rust']

/** What the compiler's binary answers to `--build-inputs` here: its crate folders, then the
 *  manifests and the libraries, never the test code; counted, to prove it is asked once per
 *  build. */
function stubBinary() {
  const asked: string[] = []
  const inputs = (binary: string) => {
    asked.push(binary)
    return ['./', '../math/rust/', '../page-codec-wasm/', 'Cargo.toml', 'src/lib.rs']
      .concat(['../page-codec-wasm/Cargo.toml', '../page-codec-wasm/src/lib.rs'])
      .concat(['../math/rust/Cargo.toml', '../math/rust/src/lib.rs'])
  }
  return { asked, inputs }
}

async function linkedCrates() {
  const packages = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'))
  const root = join(packages, 'asset-compiler-rust')
  const binary = join(root, 'target/release', binaryName)
  await mkdir(join(root, 'target/release'), { recursive: true })
  await writeFile(binary, '')
  const files = [binary]
  for (const crate of CRATES) {
    await mkdir(join(packages, crate, 'src/golden'), { recursive: true })
    await writeFile(join(packages, crate, 'Cargo.toml'), '[package]\n')
    await writeFile(join(packages, crate, 'src/lib.rs'), '#[cfg(test)]\nmod screen;\n')
    for (const test of ['src/lib_tests.rs', 'src/golden/value.rs', 'src/screen.rs'])
      await writeFile(join(packages, crate, test), '')
    const sources = ['Cargo.toml', 'src/lib.rs', 'src/lib_tests.rs', 'src/golden/value.rs']
    files.push(...[...sources, 'src/screen.rs'].map((file) => join(packages, crate, file)))
  }
  for (const file of files) await utimes(file, 1_000, 1_000)
  await utimes(binary, 2_000, 2_000)
  return { packages, root, binary }
}

for (const linked of ['page-codec-wasm', 'math/rust'])
  test(`editing ${linked} beside the crate reports the compiler stale`, async () => {
    const { packages, root, binary } = await linkedCrates()
    const { inputs } = stubBinary()
    const source = join(packages, linked, 'src/lib.rs')
    try {
      assert.equal(sourceNewerThan(binary, root, inputs), null)
      await utimes(source, 3_000, 3_000)
      assert.equal(sourceNewerThan(binary, root, inputs), source)
    } finally {
      await rm(packages, { recursive: true, force: true })
    }
  })

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

// Behaviour: a binary that cannot tell what it was built from — one built before
// `--build-inputs` — names no crate folder either: any newer file of its own crate, test code
// too, makes it stale.
test('a binary that cannot list its inputs is stale on any newer file of its crate', async () => {
  const { packages, root, binary } = await linkedCrates()
  const test = join(root, 'src/lib_tests.rs')
  try {
    assert.equal(
      sourceNewerThan(binary, root, () => null),
      null,
    )
    await utimes(test, 3_000, 3_000)
    assert.equal(
      sourceNewerThan(binary, root, () => null),
      test,
    )
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})

// Behaviour: a binary that cannot list its inputs still has the linked crates walked, from the
// last good listing kept beside it when there is one, else the crates a pre-flag build read.
test('a binary that cannot list its inputs is stale on a newer linked crate file', async () => {
  const { packages, root, binary } = await linkedCrates()
  const source = join(packages, 'math/rust/src/lib.rs')
  try {
    assert.equal(
      sourceNewerThan(binary, root, () => null),
      null,
    )
    await utimes(source, 3_000, 3_000)
    assert.equal(
      sourceNewerThan(binary, root, () => null),
      source,
    )
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})

test("an older build's kept listing names the folders a newer unlisting build walks", async () => {
  const { packages, root, binary } = await linkedCrates()
  const { inputs } = stubBinary()
  const source = join(packages, 'page-codec-wasm/src/lib.rs')
  try {
    assert.equal(sourceNewerThan(binary, root, inputs), null)
    await utimes(binary, 2_500, 2_500)
    await utimes(source, 3_000, 3_000)
    assert.equal(
      sourceNewerThan(binary, root, () => null),
      source,
    )
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
