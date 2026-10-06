import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { directLightTimings, gpuPassStageOf } from './mapping.ts'
import { PASSES } from './passTable.ts'
import { VSM_PASS_PREFIX } from './passLabels.ts'
import type { GpuPassTimings } from '../../../sdk-core/src/index.ts'

const sample = (passes: GpuPassTimings['passes']): GpuPassTimings => ({
  frame: 1,
  totalMs: null,
  truncated: false,
  passes,
})

// The virtual shadow maps' passes are timed with the Shadows stage, each in exactly one stage.
test('every virtual shadow map pass label the engine can emit lands in the Shadows stage only', () => {
  const root = new URL('../', import.meta.url)
  const files = [
    'vsm/markingPass.ts',
    'vsm/projectionPass.ts',
    'vsm/projectionMaskTable.ts',
    'vsm/invalidationPass.ts',
    'vsm/pageManagementPass.ts',
    'vsm/transmissionPass.ts',
    'vsm/renderPass.ts',
  ]
  const labels = new Set<string>()
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8')
    for (const m of text.matchAll(/['`](vsm\.[\w.() ${}]*)['`]/g))
      labels.add(m[1].replace(/\$\{[^}]*\}/g, '0'))
  }
  assert.ok(labels.size >= 15, `the scan reached the passes (${labels.size})`)
  for (const label of labels) assert.equal(gpuPassStageOf(label), 'shadows', label)
  assert.deepEqual(
    Object.keys(PASSES).filter((name) => name.startsWith(VSM_PASS_PREFIX)),
    [],
    'the prefix is the one rule: no pass of the table repeats it',
  )
  const s = sample([...labels].map((name) => ({ name, gpuMs: 1 })))
  assert.equal(directLightTimings(s).gpuShadowsMs, labels.size)
})
