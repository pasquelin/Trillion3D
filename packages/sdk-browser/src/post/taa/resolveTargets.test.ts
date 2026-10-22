// Every resolve is drawn, into targets made without storage, after the analysis's dispatches, all
// under the temporal antialiasing's pass label (`../../diagnostic/stage/passTable.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { TAA_PASS } from '../../diagnostic/stage/passLabels.ts'

/** The passes two frames begin — the second resolving display layers, once its
 *  twin has compiled —, the three resolves drawn at preparation, and whether each target stores. */
async function resolvePasses() {
  const { device, renderPipelines, textures, passes, computePasses } = fakeDevice()
  const temporal = await createTemporalAntialiasing(device, createVelocity(device, []))
  const drawn = renderPipelines.map(({ fragment }) => fragment!.module.label).slice(0, 3)
  temporal.resize(8, 4, 8, 4)
  const encoder = device.createCommandEncoder()
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer
  const encode = () =>
    temporal.encode(
      encoder,
      {
        current: view(),
        depth: view(),
        ids: view(),
        pages: buffer,
        motion: buffer,
        pool: buffer,
        positions: buffer,
        uvs: buffer,
        filter: [view(), view()],
      },
      [8, 4],
    )
  // The first frame resolves no layer, its filtered twin compiling off the frame.
  encode()
  await new Promise((done) => setImmediate(done))
  encode()
  temporal.dispose()
  // The zero texel bound for a reactive value is no target.
  const stored = textures
    .filter(({ label }) => label?.match(/^Trillion3D TAA .* \d$/))
    .map(({ label, usage }) => [label, !!(usage & GPUTextureUsage.STORAGE_BINDING)] as const)
  const begun = [
    ...passes.map(({ label, colors }) => ({ kind: 'render', label, attachments: colors.length })),
    ...computePasses.map(({ label }) => ({ kind: 'compute', label })),
  ]
  return { drawn, begun, stored }
}

const TARGETS = [
  'history 0',
  'share 0',
  'history 1',
  'share 1',
  'display tint 0',
  'display added value 0',
  'display tint 1',
  'display added value 1',
]

test('every resolve is drawn, after the analysis, and no history target is stored', async () => {
  const byDefault = await resolvePasses()
  assert.deepEqual(byDefault.drawn, ['TAA_RESOLVE', 'TAA_RESOLVE_FLAGLESS', 'TAA_RESOLVE_BLENDED'])
  // Each frame: the spatial anti-aliaser's draw into its one target, then the resolve, into the
  // colour and the share target — its filtered twin into the layers' two besides; the analysis's
  // compute pass (nearest velocity, reprojection, flicker, rejection) before each.
  const spatial = { kind: 'render', label: TAA_PASS, attachments: 1 },
    dispatch = { kind: 'compute', label: TAA_PASS }
  assert.deepEqual(byDefault.begun, [
    spatial,
    { kind: 'render', label: TAA_PASS, attachments: 2 },
    spatial,
    { kind: 'render', label: TAA_PASS, attachments: 4 },
    dispatch,
    dispatch,
  ])
  // The history and layer targets are never stored: a device may compress them (Metal's
  // `shaderWrite`). The render-resolution histories are written by the analysis's dispatches.
  assert.deepEqual(
    byDefault.stored
      .filter(([label]) => !label?.match(/(shading|flicker) history/))
      .map(([label]) => label?.replace('Trillion3D TAA ', ''))
      .sort(),
    [...TARGETS].sort(),
  )
  assert.deepEqual(
    byDefault.stored.filter(
      ([label, stores]) => stores && !label?.match(/(shading|flicker) history/),
    ),
    [],
  )
})
