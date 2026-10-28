import test from 'node:test'
import assert from 'node:assert/strict'
import { SUNS_LAYOUT } from '../shadows/vsm/layout.fixture.ts'
import { VSM_SAMPLE_MARKING_ENTRY, vsmSampleMarkingWgsl } from './vsmSampleMarkingWgsl.ts'

test('the marking from the samples uses the pixel pass’s page functions and keeps its two groups apart', () => {
  for (const throttled of [false, true]) {
    const code = vsmSampleMarkingWgsl(SUNS_LAYOUT, throttled)
    assert.ok(code.includes(`fn ${VSM_SAMPLE_MARKING_ENTRY}(`))
    assert.ok(
      code.includes('fn vsmMarkPageLocal(') && code.includes('fn vsmMarkPageDirectional('),
      'imported, not copied',
    )
    assert.ok(
      code.includes('@group(1) @binding(120) var<uniform> params'),
      'the uniform in group 1',
    )
    assert.ok(!code.includes('@group(0) @binding(120)'))
  }
})
