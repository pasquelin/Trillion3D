// The cull leaves a candidate out of a light whose lighting channels it shares none of
// (`renderCullWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const CULL = vsmRenderCullWgsl(SUNS_LAYOUT)

// A caster shares a lighting channel with a light or casts none into its maps: the cull leaves a
// candidate out of a light whose channels it has none of (`vsmRenderCullCandidate`).
test('a caster in none of the light’s lighting channels is left out of its maps', () => {
  const C = wgslConstants(CULL)
  const views: number[][] = []
  const run = (casterChannels: number, lightChannels: number) => {
    const called: unknown[][] = []
    const flags = casterChannels << C.VSM_RENDER_CAND_CHANNELS_SHIFT!
    const cand = {
      ...{ c: [0, 0, 0, 1], l: [0, 0, 0], a0: [1, 0, 0], a1: [0, 1, 0], a2: [0, 0, 1] },
      flags,
    }
    views.length = 0
    views.push([0, 1, 0, lightChannels << C.VSM_RENDER_VIEW_CHANNELS_SHIFT!])
    const { vsmRenderCullCandidate } = shaderRun<{
      vsmRenderCullCandidate(...a: unknown[]): void
    }>(CULL, ['vsmRenderCullCandidate'], {
      ...C,
      counts: [1, 0, 0, 0, 1],
      candidates: [cand],
      views,
      params: { lightCount: 1 },
      atomicLoad: (p: { get: () => number }) => p.get(),
      vsmHandleFromId: (id: number) => ({ id }),
      vsmProjectionOf: () => ({
        ...{ firstPerson: false, lightRange: 1e9 },
        ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
      }),
      vsmRenderCullView: (...args: unknown[]) => called.push(args),
    })
    vsmRenderCullCandidate([0, 0, 0], [1, 1, 1], 0, C.VSM_RENDER_CULL_ALL)
    return called.length
  }
  assert.equal(run(0b001, 0b001), 1, 'the default channel, shared')
  assert.equal(run(0b011, 0b010), 1, 'one channel of two shared')
  assert.equal(run(0b001, 0b110), 0, 'none shared: left out')
  assert.equal(run(0, 0b111), 0, 'a caster in no channel casts into none')
})
