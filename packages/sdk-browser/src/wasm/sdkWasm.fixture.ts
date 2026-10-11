import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm } from './sdkWasm.ts'

// Node cannot fetch the module by its URL: the tests hand it the bytes the repository ships, once,
// before anything cuts a page.
const loaded = await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'kernels.wasm')))
if (!loaded) throw new Error('the SDK module does not instantiate')

/** The SDK WebAssembly module, instantiated for the tests. */
export const sdkWasm = loaded
