import { sdkWasm } from '../../wasm/sdkWasm.fixture.ts'
import { encodeGeometryPage } from './encodeGeometryPage.ts'

/** `encodeGeometryPage` on the SDK module the repository ships, for the tests' pages. */
export const encodePage = (
  ...page: Parameters<typeof encodeGeometryPage> extends [unknown, ...infer Rest] ? Rest : never
) => encodeGeometryPage(sdkWasm, ...page)
