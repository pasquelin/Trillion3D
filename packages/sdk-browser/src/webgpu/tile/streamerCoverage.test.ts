// #42: a hosted map follows its readers' coverage rule after prepare: reduced again and copied at
// the next image's follow, with no new prepare; a still rule reduces nothing, a moved picture once.
// #748: a new cutoff is a new rule, the chain counted at it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileStreamer } from './streamer.ts'
import { tileCatalogue } from './catalogue.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { CoverageReaders } from '../../texture/coverage.ts'
import { surfaceOf } from '../../page/surface.ts'
import { hostTextureWritten, importHostTexture } from '../../host/textureImport.ts'
import type { HostTexture } from '../../host/resources.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import * as G from '../../host/graph/graph.fixture.ts'

test('a surface switched from masked to opaque after prepare reduces its hosted map again', async () => {
  installGpuGlobals()
  const host = G.dataTexture(new Uint8Array(64), 4, 4)
  host.magFilter = G.HOST_FILTER_LINEAR
  host.minFilter = G.HOST_FILTER_LINEAR_MIP_LINEAR
  const material = G.standardSurface({ map: host, alphaTest: 0.5 })
  const readers = new CoverageReaders()
  readers.read(surfaceOf(material))
  const map = importHostTexture(host as unknown as HostTexture),
    encoding = poolEncoding(undefined)
  const { device, computePipelines, textures: made, computes, textureWrites } = mockGpu()
  const signalled: number[][] = []
  const lossless = { lossless: 2, rgba: 0, 'two-channel': 0 }
  const textures = createWebgpuTileStreamer({
    device,
    color: tileCatalogue([map], () => undefined, undefined, encoding, readers),
    data: tileCatalogue([], () => undefined, undefined, encoding),
    layers: { color: lossless, data: lossless },
    encoding,
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: (slots) => void signalled.push(slots === -1 ? [-1] : [...slots]),
  })
  textures.prepare()
  const rules = () =>
    computePipelines
      .filter(({ compute }) => compute.entryPoint === 'reduceLevel')
      .map(({ compute }) => compute.constants?.weighted)
  const scratches = () => made.filter((texture) => texture.label === 'Trillion3D texture scratch')
  assert.deepEqual(rules(), [1], 'masked at prepare: weighted')
  const counted = () => computes.filter((entry) => entry === 'choose').length
  assert.equal(counted(), 2, 'both reduced levels of the 4 × 4 chain counted at its cutoff')
  assert.equal(textures.followSampling(), false, 'no filter rule switched')
  assert.deepEqual([signalled, scratches().length], [[], 1], 'a still rule reduces nothing')
  material.alphaTest = 0
  assert.equal(textures.followSampling(), false)
  assert.deepEqual(rules(), [1, 0], 'opaque now: reduced again, plain')
  assert.deepEqual(signalled, [[1]], 'its places copied again, as a landed tile')
  assert.ok(
    scratches().every((texture) => texture.destroyed),
    'the working texture returned',
  )
  textures.followSampling()
  assert.equal(scratches().length, 2, 'once')
  material.alphaTest = 0.5
  host.needsUpdate = true
  hostTextureWritten()
  await Promise.resolve()
  textures.followSampling()
  assert.equal(scratches().length, 3, 'reduced once, by its new picture, never twice')
  material.alphaTest = 0.25
  textures.followSampling()
  assert.equal(counted(), 6, 'a new cutoff reduces its chain again')
  // Append must not acknowledge a neighbour's pending image/filter change as already uploaded.
  const extra = G.dataTexture(new Uint8Array(16), 2, 2)
  const extraMap = importHostTexture(extra as unknown as HostTexture)
  const [, entry] = tileCatalogue([extraMap], () => undefined, undefined, encoding, readers)
  const beforeAppend = scratches().length,
    uploadedBeforeAppend = textureWrites.length
  host.needsUpdate = true
  host.magFilter = G.HOST_FILTER_NEAREST
  hostTextureWritten()
  await Promise.resolve()
  const appended = textures.append('color', entry)
  assert.equal(scratches().length, beforeAppend + 1, 'only the new source uploads at append')
  assert.equal(textures.followSampling(), true, 'the existing filter switch reaches row classes')
  assert.equal(textureWrites.length, uploadedBeforeAppend + 2, 'the neighbour picture uploads')
  assert.equal(scratches().length, beforeAppend + 1, 'the live scratch is refilled in place')
  assert.deepEqual(signalled.at(-1), [1])
  // A drop must keep the last reduced rule of surviving maps, even if another reader filed it.
  material.alphaTest = 0
  readers.follow([map])
  const beforeDrop = scratches().length,
    signalsBeforeDrop = signalled.length
  textures.release('color', appended)
  textures.followSampling()
  assert.equal(scratches().length, beforeDrop, 'the live scratch is reused for reduction')
  assert.equal(signalled.length, signalsBeforeDrop + 1, 'the pending coverage rule is observed')
  assert.deepEqual(signalled.at(-1), [1])
  const signalsAfterDrop = signalled.length
  textures.followSampling()
  assert.equal(signalled.length, signalsAfterDrop, 'the surviving rule is reduced once')
  textures.destroy()
  material.dispose()
})
