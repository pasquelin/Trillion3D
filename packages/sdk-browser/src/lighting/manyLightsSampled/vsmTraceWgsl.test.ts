import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmFragmentTraceWgsl } from '../direct/shadowTraceWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { VSM_TRACE_BINDING, VSM_TRACE_ENTRY, vsmTraceSamplesWgsl } from './vsmTraceWgsl.ts'

test('the map trace of the samples casts one ray for a local light and keeps the view’s count for the suns', () => {
  const code = vsmTraceSamplesWgsl()
  assert.ok(code.includes(`fn ${VSM_TRACE_ENTRY}(`))
  assert.ok(code.includes('fn vsmTraceFactor('))
  assert.ok(code.includes('let rays=select(1u,vsmView.traceRays.x,'))
  assert.ok(!code.includes('let rays=select(vsmView.traceRays.y'))
})

test('the trace of every other caller keeps its text: the view’s count of rays', () => {
  const trace = { view: VSM_TRACE_BINDING.view, noise: VSM_TRACE_BINDING.noise }
  const code = wgslModule(vsmFragmentTraceWgsl(VSM_TRACE_BINDING.pool, trace, 3))
  assert.ok(code.includes('let rays=select(vsmView.traceRays.y,vsmView.traceRays.x,directional);'))
})
