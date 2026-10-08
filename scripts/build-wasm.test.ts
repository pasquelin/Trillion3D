// `checkInstructionSet` rejects any module that does not carry `simd128`, or that carries a
// "relaxed" feature — the only WebAssembly instruction family with non-guaranteed rounding, which would break
// bit-for-bit equality of `packages/page-codec-wasm/src/math.rs` kernels. Each case is a minimal dummy
// WebAssembly module (header + custom `target_features` section), without going through
// `cargo build`: importing this script never triggers it (`main()` only runs via CLI).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkInstructionSet } from './build-wasm.ts'

/** An unsigned integer in LEB128, as required by WebAssembly binary format lengths. */
function leb128(n: number): number[] {
  const bytes: number[] = []
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n) byte |= 0x80
    bytes.push(byte)
  } while (n)
  return bytes
}

/**
 * A minimal valid WebAssembly module — header only — carrying a single custom section
 * `target_features` whose content is the given text: exactly what `checkInstructionSet` reads,
 * without depending on a real capability encoding.
 */
function fakeModule(features: string): Buffer {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
  const name = Buffer.from('target_features', 'utf8')
  const payload = Buffer.from(features, 'latin1')
  const body = [...leb128(name.length), ...name, ...payload]
  return Buffer.from([...header, 0x00, ...leb128(body.length), ...body])
}

function fakeFile(dir: string, features: string): string {
  const path = join(dir, 'fake.wasm')
  writeFileSync(path, fakeModule(features))
  return path
}

test('a module with simd128 and without relaxed feature is accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trillion3d-build-wasm-'))
  try {
    assert.doesNotThrow(() => checkInstructionSet(fakeFile(dir, '+simd128')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a module without simd128 is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trillion3d-build-wasm-'))
  try {
    assert.throws(() => checkInstructionSet(fakeFile(dir, '+multivalue')), /simd128 missing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a module carrying relaxed-simd is rejected even with simd128', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trillion3d-build-wasm-'))
  try {
    assert.throws(
      () => checkInstructionSet(fakeFile(dir, '+simd128+relaxed-simd')),
      /"relaxed" capability present/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('importing the script does not run compilation', () => {
  // If `main()` ran on import, this test would fail long before reaching here: `cargo`
  // is not guaranteed to be installed on the machine running `pnpm test`.
  assert.equal(typeof checkInstructionSet, 'function')
})
