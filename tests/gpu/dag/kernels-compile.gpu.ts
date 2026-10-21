// Every stage of the DAG selection kernel compiles and validates on the machine's device:
// the text the engine compiles (`shader.ts`, the cut kernels), then the engine's own stages
// (`createDagStages`). The Node gate only parses the text; here the GPU's own WGSL compiler reads
// it. The proof can fail: a copy with a WGSL syntax error in a placement's scales
// (`primitiveWgsl.ts`), and one with a type error, must each be refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/geometry/dag/shader/shader.ts'
import { loadPage, runOnDawn } from '../../kit/device/onDawn.ts'
import type { KernelText } from './kernelsCompilePage.ts'

const SCALES =
  'let s=vec3f(length(placedPose[0].xyz),length(placedPose[1].xyz),length(placedPose[2].xyz));'

/** The kernel with `from` replaced by `to`: the edit must land. */
function edited(from: string, to: string) {
  assert.ok(DAG_SELECTION_SHADER.includes(from), `${from} is no longer in the kernel`)
  return DAG_SELECTION_SHADER.replace(from, to)
}

const SOURCES = {
  shipped: DAG_SELECTION_SHADER,
  'syntax error': edited(SCALES, SCALES.slice(0, -1)),
  'type error': edited(SCALES, SCALES.replace('let s=', 'let s:u32=')),
}
const texts: KernelText[] = Object.entries(SOURCES).map(([name, code]) => ({ name, code }))

// One device for every text: both tests read the same run.
const run = (async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'kernelsCompilePage.ts'),
    'dagKernels',
  )) as typeof import('./kernelsCompilePage.ts')
  return runOnDawn(page.compileKernels, texts)
})()
const verdictsOf = async (source: string) =>
  (await run).verdicts.filter(({ name }) => name === source)

test('every DAG selection stage compiles and validates on the GPU', async () => {
  const verdicts = await verdictsOf('shipped')
  assert.equal(verdicts.length, 1)
  assert.deepEqual(
    verdicts.filter(({ errors }) => errors.length),
    [],
  )
  const { adapter, uncaptured } = await run
  assert.deepEqual(uncaptured, [])
  console.log(JSON.stringify({ adapter, verdicts: verdicts.length }))
})

test('a WGSL syntax error or type error in the kernel is refused', async () => {
  for (const source of ['syntax error', 'type error'])
    for (const { name, errors } of await verdictsOf(source))
      assert.ok(
        errors.some((error) => error.startsWith('module:')),
        `${name}: not refused`,
      )
})
