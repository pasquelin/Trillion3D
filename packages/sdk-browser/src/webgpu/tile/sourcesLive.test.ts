// #362: a live texture's raw texels that ask a turn go up into one texture of their own, made at
// its first picture and kept while pictures keep coming — never made again a picture —, the turn
// the first step of each reduction; it is let go with the working texture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileSources } from './sources.ts'
import { createTileCounters } from './counters.ts'
import { tileCatalogue } from './catalogue.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('a live texture keeps its raw texels between pictures, let go with it', () => {
  installGpuGlobals()
  const { device, textures, destroyed } = fakeDevice(BACKEND)
  const host = new Texture({ data: new Uint8Array(16), width: 2, height: 2 })
  host.flipY = true
  const encoding = poolEncoding(undefined)
  const maps = [host]
  const atlas = {
    kind: 'color',
    textures: tileCatalogue(maps, () => undefined, encoding),
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
  const raws = textures.filter(({ label }) => label === 'Trillion3D texture raw texels')
  assert.equal(raws.length, 1, 'its raw texels made once, kept for every picture')
  assert.ok(!destroyed.includes(raws[0]), 'held between pictures')
  sources.destroy()
  assert.ok(destroyed.includes(raws[0]), 'let go with the working texture')
})
