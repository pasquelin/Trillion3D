// The census decides each hosted texture's reduction rule: weighted only when every surface reading
// it takes its alpha for coverage; the working textures are built after the pass, two at most.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileSources } from './sources.ts'
import { createTileCounters } from './counters.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { tileCatalogue } from './catalogue.ts'
import { collectWebgpuMaterialTextures } from '../core/materialTextures.ts'
import { importHostTexture } from '../../host/textureImport.ts'
import { GraphTexture } from '../../host/graph/graph.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'

// The wiring from the material census to the GPU reduction: a hosted colour texture reduces
// with the weighted pipeline only when every surface reading it takes its alpha for coverage —
// masked or blended by its alpha —; one read by an opaque surface, also as an emissive map, or by
// a surface whose blending draws the colour under alpha 0 (`none`) or that transmits, stays plain.
test('a hosted texture is reduced weighted only when every reader takes it for coverage', async () => {
  installGpuGlobals()
  const map = () =>
    importHostTexture(new GraphTexture({ data: new Uint8Array(16), width: 2, height: 2 }))
  const [masked, opaque, mixed, blended, unblended, glass] = [1, 2, 3, 4, 5, 6].map(map)
  const surface = (fields: object) => ({ alphaTest: 0, transparent: false, ...fields })
  const pages = [
    surface({ map: masked, alphaTest: 0.5 }),
    surface({ map: opaque }),
    surface({ map: mixed, alphaTest: 0.5 }),
    surface({ emissiveMap: mixed }),
  ].map((material) => ({ material }) as unknown as PageRec)
  const copies = [
    { surface: surface({ map: blended, transparent: true, blending: 'normal' }) },
    { surface: surface({ map: unblended, transparent: true, blending: 'none' }) },
    { surface: surface({ map: glass, transparent: true, blending: 'normal', transmission: 1 }) },
  ] as BlendCopy[]
  const census = collectWebgpuMaterialTextures(pages, copies, new Map(), new Map())
  const encoding = poolEncoding(undefined)
  const hosted = () => undefined
  const textures = tileCatalogue(census.maps, hosted, undefined, encoding, census.coverage)
  const atlas = {
    kind: 'color',
    textures,
    roomFor: () => true,
    place: () => ({ x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: { format: 'rgba8unorm-srgb' } }),
  } as unknown as WebgpuTileAtlas
  const on = (device: GPUDevice, slots: number[]) => {
    const sources = createTileSources({
      device,
      encoding,
      counters: createTileCounters(),
      onFailure: (_, error) => assert.fail(error as Error),
    })
    const encoder = () => device.createCommandEncoder()
    const pass = () =>
      slots.map((slot) => sources.serve(atlas, { slot, level: 0, tx: 0, ty: 0 }, 1, encoder))
    return { sources, pass }
  }
  // One device per pass: the reduction pipelines it builds say the rules its textures took.
  const rulesOf = async (...slots: number[]) => {
    const { device, computePipelines, submits, textures: made } = mockGpu()
    const { sources, pass } = on(device, slots)
    // The pass that asks builds nothing — no texture, no upload, no submit —; a task
    // after it builds the working textures asked, their mips in one submit.
    const before = made.length
    assert.ok(pass().every((verdict) => verdict === 'waiting'))
    sources.endPass()
    assert.equal(made.length, before, 'nothing built inside the pass')
    assert.equal(sources.reading, true, 'a tile is still coming: the barrier waits for it')
    await sources.settled()
    assert.equal(sources.reading, false)
    assert.equal(submits.length, 1, 'the working textures reduced in one submit')
    // A pass with no newer feedback does not free what was built for its tiles unread.
    sources.endPass(undefined, 1)
    assert.ok(pass().every((verdict) => verdict === 'served'))
    return computePipelines
      .filter(({ compute }) => compute.entryPoint === 'reduceLevel')
      .map(({ compute }) => compute.constants?.weighted)
  }
  const rules: unknown[] = []
  for (let slot = 1; slot <= census.maps.length; slot++) rules.push(await rulesOf(slot))
  assert.deepEqual(
    rules,
    [[1], [0], [0], [1], [0], [0]],
    'masked and blended weighted; opaque, mixed, unblended and transmissive plain',
  )
  assert.deepEqual(await rulesOf(1, 2), [1, 0], 'a masked and an opaque texture, one batch')
  // Two working textures at most a pass: a third texture's tiles wait for a pass with room.
  const { sources, pass } = on(mockGpu().device, [1, 2, 3])
  pass()
  await sources.settled()
  assert.deepEqual(pass(), ['served', 'served', 'waiting'])
})
