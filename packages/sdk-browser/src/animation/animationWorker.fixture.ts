// The animation worker (`animationWorker.ts`) as a Node thread runs it: the module's bytes read
// from disk first — Node's `fetch` does not follow a file URL —, then the worker's own entry.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm } from '../wasm/sdkWasm.ts'

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../wasm/kernels.wasm')))
await import('./animationWorker.ts')
