// The SDK WebAssembly module's loader. `requireSdkWasm` remembers its decision for the whole
// process; each hostile scenario therefore imports a fresh instance of the module (different
// specifier, same file) so it does not inherit the others' cache.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MODULE = readFileSync(join(import.meta.dirname, 'kernels.wasm'))

type WasmModule = typeof import('./sdkWasm.ts')
let counter = 0
/** A fresh loader instance: its remembered `pending` has not decided anything yet. */
function fresh(): Promise<WasmModule> {
  return import(`./sdkWasm.ts?fresh=${counter++}`) as Promise<WasmModule>
}

test('valid bytes instantiate the module and its kernels', async () => {
  const { requireSdkWasm } = await fresh()
  const wasm = await requireSdkWasm(MODULE)
  assert.equal(typeof wasm.arena_alloc, 'function')
})

test('bytes that are not a valid WebAssembly module are refused by name', async () => {
  const { requireSdkWasm } = await fresh()
  await assert.rejects(requireSdkWasm(new Uint8Array([1, 2, 3, 4])), /SDK_WASM_UNAVAILABLE/)
})

test('a simulated engine without SIMD — instantiation that throws — is refused by name', async () => {
  const { requireSdkWasm } = await fresh()
  const original = WebAssembly.instantiate
  // Simulates an engine that refuses to compile the module (SIMD missing, for example).
  WebAssembly.instantiate = () => {
    throw new WebAssembly.CompileError('simd absent')
  }
  try {
    await assert.rejects(requireSdkWasm(MODULE), /SDK_WASM_UNAVAILABLE/)
  } finally {
    WebAssembly.instantiate = original
  }
})

test('with no WebAssembly at all, the module is refused by name', async () => {
  const { requireSdkWasm } = await fresh()
  const original = globalThis.WebAssembly
  // @ts-expect-error: simulates a platform without WebAssembly.
  delete globalThis.WebAssembly
  try {
    await assert.rejects(requireSdkWasm(MODULE), /SDK_WASM_UNAVAILABLE/)
  } finally {
    globalThis.WebAssembly = original
  }
})

test('a module the server refuses once is asked again, as every engine file is', async (t) => {
  let asked = 0
  t.mock.method(globalThis, 'fetch', async () =>
    ++asked === 1 ? new Response(null, { status: 503 }) : new Response(MODULE),
  )
  const { requireSdkWasm } = await fresh()
  assert.ok(await requireSdkWasm(), 'the second answer instantiates')
  assert.equal(asked, 2)
})
