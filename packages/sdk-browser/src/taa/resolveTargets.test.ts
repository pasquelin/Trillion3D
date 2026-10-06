// Every resolve is drawn, into targets made without storage, under the temporal antialiasing's pass
// label (`../stage/passTable.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { TAA_PASS } from '../stage/passLabels.ts'

/** The passes two frames begin — the second resolving display layers, once its
 *  twin has compiled —, the three resolves drawn at preparation, and whether each target stores. */
async function resolvePasses() {
  const { device, renderPipelines, textures } = fakeDevice({ compute: false })
  const temporal = await createTemporalAntialiasing(device, [])
  const drawn = renderPipelines.map(({ fragment }) => fragment!.module.label).slice(0, 3)
  temporal.resize(8, 4)
  const begun: { kind: string; label?: string; attachments: number }[] = []
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    draw() {},
    end() {},
  }
  const encoder = {
    beginRenderPass: (d: GPURenderPassDescriptor) => (
      begun.push({ kind: 'render', label: d.label, attachments: [...d.colorAttachments].length }),
      pass
    ),
  } as unknown as GPUCommandEncoder
  const view = () => ({}) as GPUTextureView,
    buffer = {} as GPUBuffer
  const encode = () =>
    temporal.encode(encoder, {
      current: view(),
      depth: view(),
      ids: view(),
      pages: buffer,
      motion: buffer,
      pool: buffer,
      positions: buffer,
      uvs: buffer,
      filter: [view(), view()],
    })
  // The first frame resolves no layer, its filtered twin compiling off the frame.
  encode()
  await new Promise((done) => setImmediate(done))
  encode()
  temporal.dispose()
  // The zero texel bound for a reactive value is no target.
  const stored = textures
    .filter(({ label }) => label?.match(/^Trillion3D TAA .* \d$/))
    .map(({ label, usage }) => [label, !!(usage & GPUTextureUsage.STORAGE_BINDING)] as const)
  return { drawn, begun, stored }
}

const TARGETS = [
  'geometry 0',
  'flicker 0',
  'history 0',
  'as-is share 0',
  'geometry 1',
  'flicker 1',
  'history 1',
  'as-is share 1',
  'display tint 0',
  'display added value 0',
  'display tint 1',
  'display added value 1',
]

test('every resolve is drawn, with no compute pipeline and no storage on a target', async () => {
  const byDefault = await resolvePasses()
  assert.deepEqual(byDefault.drawn, ['TAA_RESOLVE', 'TAA_RESOLVE_FLAGLESS', 'TAA_RESOLVE_BLENDED'])
  // Its filtered twin draws the layers' two targets besides, under the same label.
  assert.deepEqual(byDefault.begun, [
    { kind: 'render', label: TAA_PASS, attachments: 4 },
    { kind: 'render', label: TAA_PASS, attachments: 6 },
  ])
  // The history, geometry, flicker and layer targets are never stored: a device may compress them
  // (Metal's `shaderWrite`).
  assert.deepEqual(
    byDefault.stored.map(([label]) => label?.replace('Trillion3D TAA ', '')).sort(),
    [...TARGETS].sort(),
  )
  assert.deepEqual(
    byDefault.stored.filter(([, stores]) => stores),
    [],
  )
})
