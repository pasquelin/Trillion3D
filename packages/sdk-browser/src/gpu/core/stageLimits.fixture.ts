import assert from 'node:assert/strict'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'

/** Every stage of every layout of `layouts` within WebGPU's defaults (`limitOf`, the kit device's
 *  one table), each kind; `where` names the programs. */
export function withinDefaults(layouts: GPUPipelineLayoutDescriptor[], where: string) {
  assert.ok(layouts.length > 0, `${where}: built`)
  for (const layout of layouts)
    for (const { limit, kind, count } of stageBindingCounts(layout)) {
      const max = limitOf(limit)
      assert.ok(count <= max, `${where}: ${count} ${kind}, past ${max}`)
    }
}
