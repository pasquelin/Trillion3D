import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm } from '../../wasm/sdkWasm.ts'
import { encodeGeometryPage } from './encodeGeometryPage.ts'

// Node cannot fetch the module by its URL: the fixtures hand it the bytes, as the decoder's tests do.
const module = await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../wasm/kernels.wasm')),
)
if (!module) throw new Error('the SDK module does not instantiate')

/** `encodeGeometryPage` on the SDK module the repository ships, for the tests' pages. */
export const encodePage = (
  ...page: Parameters<typeof encodeGeometryPage> extends [unknown, ...infer Rest] ? Rest : never
) => encodeGeometryPage(module, ...page)
