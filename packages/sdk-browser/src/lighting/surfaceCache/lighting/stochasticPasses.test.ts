// The order of the stochastic light's passes: its generation picks the lights of the tiles in the place of the cull, the light tiles are placed and
// compacted, the masks (and the masks of the lights apart from the atlas) follow, then the traces of the samples are compacted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { directPasses, type Encoding } from './passes.ts'

const anything = (label: string): unknown =>
  new Proxy(function () {}, {
    get: (_, key) => (key === 'then' ? undefined : anything(`${label}.${String(key)}`)),
    apply: () => anything(label),
  })

function run(stochastic: boolean) {
  const calls: string[] = []
  const kernel = { group: () => ({}), pipeline: (entry: string) => ({ entry }) }
  const kernels = new Proxy({}, { get: () => kernel })
  const e = {
    pass: {
      setPipeline: (p: { entry: string }) => calls.push(p.entry),
      setBindGroup: () => undefined,
      dispatchWorkgroups: () => undefined,
      dispatchWorkgroupsIndirect: () => undefined,
    },
    resources: anything('resources'),
    lightSlots: anything('slots'),
    atlases: anything('atlases'),
    inputs: anything('inputs'),
    fixed: kernels,
    shaped: kernels,
    tables: {},
    noise: {},
    width: 1,
    pages: 1,
    cullToTileDepthRange: true,
    standalone: { passes: [], flags: {}, given: undefined },
    traced: {
      kernels: kernels,
      buffers: { masks: {}, traces: {} },
      sceneTrace: { maskReads: { color: { views: [], pages: { buffer: {} } }, sampler: {} } },
      views: {},
    },
    stochastic: stochastic
      ? {
          kernels,
          buffers: { samples: {}, resolved: {}, history: [{}, {}] },
          read: 0,
          temporal: false,
        }
      : undefined,
  } as unknown as Encoding
  directPasses(e)
  return calls
}

test('the stochastic generation takes the cull’s place, before the light tiles are placed, and the traces are compacted after the masks', () => {
  const calls = run(true)
  assert.ok(!calls.includes('cullLights'))
  assert.ok(
    !calls.includes('tileDepthRanges'),
    'no depth range pass: the tile’s box is the card’s whole depth',
  )
  const at = (entry: string) => calls.indexOf(entry)
  assert.ok(at('lightTilesClear') < at('stochasticGenerate'))
  assert.ok(at('stochasticGenerate') < at('lightTilesOffsets'))
  assert.ok(at('lightTilesCompact') < at('shadowMaskLights'))
  assert.ok(at('shadowMaskRect') < at('stochasticCompact'))
  assert.ok(at('stochasticCompact') < at('stochasticShade'))
})

test('without the stochastic light the cull picks the lights', () => {
  const calls = run(false)
  assert.ok(calls.includes('cullLights'))
  assert.ok(!calls.includes('stochasticGenerate'))
})
