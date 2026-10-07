// #362: a live texture's pictures turn through one ring and its words, taken once and kept while
// pictures keep coming — never taken back from the device's spares a picture —, given back once no
// picture came for the idle time, and destroyed once idle there, as a static picture's are.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileSources } from './sources.ts'
import { createTileCounters } from './counters.ts'
import { tileCatalogue } from './catalogue.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { importHostTexture } from '../../host/textureImport.ts'
import { GraphTexture } from '../../host/graph/graph.fixture.ts'
import { READBACK_IDLE_MS } from '../../gpu/core/heldReadback.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'

test('a live texture keeps its turn ring between pictures, given back once idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  installGpuGlobals()
  const { device, buffers } = mockGpu()
  const host = new GraphTexture({ data: new Uint8Array(16), width: 2, height: 2 })
  host.flipY = true
  const encoding = poolEncoding(undefined)
  const maps = [importHostTexture(host)]
  const atlas = {
    kind: 'color',
    textures: tileCatalogue(maps, () => undefined, undefined, encoding),
    poolOf: () => ({ texture: { format: 'rgba8unorm' }, occupied: () => [] }),
  } as unknown as WebgpuTileAtlas
  const sources = createTileSources({
    device,
    encoding,
    counters: createTileCounters(),
    onFailure: (_, error) => assert.fail(error as Error),
  })
  const slot = atlas.textures.length - 1
  for (let picture = 0; picture < 3; picture++) assert.equal(sources.refresh(atlas, slot), true)
  const turns = (buffers as unknown as { label?: string; destroyed: boolean }[]).filter(
    ({ label }) => label?.startsWith('Trillion3D texel turn'),
  )
  assert.equal(turns.length, 2, 'the ring and its words made once, kept for every picture')
  assert.ok(
    turns.every(({ destroyed }) => !destroyed),
    'held between pictures',
  )
  t.mock.timers.tick(READBACK_IDLE_MS)
  assert.ok(
    turns.every(({ destroyed }) => !destroyed),
    'given back to the spares once no picture came',
  )
  t.mock.timers.tick(READBACK_IDLE_MS)
  assert.ok(
    turns.every(({ destroyed }) => destroyed),
    'destroyed once idle in the spares',
  )
  sources.destroy()
})
