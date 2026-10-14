import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sourceNewerThan } from './freshness.mts'
import { linkedCrates, stubBinary } from './freshness.fixture.ts'

// Behaviour: the crates the compiler links — the page codec, and the maths through it — are built
// into it: an edit in either is a stale build — their folders and the edited file both from what
// the binary prints of its build, no manifest read.

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

// Behaviour: a file the build hashed outside every crate folder — a physics cook header — is read
// from the binary's own list, by its date: newer, the compiler is stale, with no list of its own.
test('a hashed file beside the crates, newer, reports the compiler stale', async () => {
  const { packages, root, binary } = await linkedCrates()
  const header = join(packages, 'physics-jolt-wasm/src/layout.h')
  const inputs = (binary: string) =>
    stubBinary().inputs(binary).concat(['../physics-jolt-wasm/src/layout.h'])
  try {
    await mkdir(join(packages, 'physics-jolt-wasm/src'), { recursive: true })
    await writeFile(header, '')
    await utimes(header, 1_000, 1_000)
    assert.equal(sourceNewerThan(binary, root, inputs), null)
    await utimes(header, 3_000, 3_000)
    assert.equal(sourceNewerThan(binary, root, inputs), header)
  } finally {
    await rm(packages, { recursive: true, force: true })
  }
})
