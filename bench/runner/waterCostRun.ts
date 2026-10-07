import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installProofGpu } from '../../tests/gpu/kit/onDawn.ts'
import type { WaterCostOptions } from '../../tests/gpu/water/waterCostPage.ts'

/** The water-cost measure on Dawn of the engine at `engineRoot`: the fixture is fixed, only the
 *  backend and its codec change when comparing two local issue worktrees. */
export async function waterCostRun(fixtureRoot: string, engineRoot: string) {
  installProofGpu()
  const from = (path: string) => import(pathToFileURL(resolve(engineRoot, path)).href)
  const { run: measure } = (await import(
    pathToFileURL(resolve(fixtureRoot, 'tests/gpu/water/waterCostPage.ts')).href
  )) as typeof import('../../tests/gpu/water/waterCostPage.ts')
  const { webgpuPagesEngine } = await from('packages/sdk-browser/src/webgpu/pages/pages.ts')
  const { prepareSdkWasm } = await from('packages/sdk-browser/src/wasm/sdkWasm.ts')
  const bytes = await readFile(resolve(engineRoot, 'packages/sdk-browser/src/wasm/kernels.wasm'))
  if (!(await prepareSdkWasm(bytes))) throw new Error('SDK WASM preload failed')
  return (options: WaterCostOptions) => measure(webgpuPagesEngine, options)
}
