import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireSdkWasm } from './sdkWasm.ts'

// Node cannot fetch the module by its URL: the tests hand it the bytes the repository ships, once,
// before anything cuts a page.
/** The SDK WebAssembly module, instantiated for the tests. */
export const sdkWasm = await requireSdkWasm(readFileSync(join(import.meta.dirname, 'kernels.wasm')))
