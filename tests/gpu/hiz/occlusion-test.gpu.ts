// The engine's Hi-Z test kernel decides each case's verdict on the GPU: a box behind a pyramid
// that covers the screen is rejected; a background hole at the pyramid's edge keeps it; and a box
// that crosses the near plane is never rejected (`occlusionTestCases.ts`, `occlusionTestPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { CASES } from './occlusionTestCases.ts'

test('the Hi-Z test rejects what the pyramid hides, and nothing else', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'occlusionTestPage.ts'),
    'hizOcclusion',
  )) as typeof import('./occlusionTestPage.ts')
  const pageErrors: string[] = []
  const { adapter, verdicts, errors } = await runOnDawn(page.testOcclusion, CASES, pageErrors)
  console.log(JSON.stringify({ adapter, verdicts }))
  assert.deepEqual([...errors, ...pageErrors], [])
  for (const [k, { name, expected }] of CASES.entries())
    assert.equal(verdicts[k], expected, `${name}: verdict`)
})
