import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../../vsm/layout.ts'
import { vsmAtlasCopyInWgsl, vsmAtlasCopyOutWgsl } from './atlasCopyWgsl.ts'
import {
  ATLAS_BIN_TIERS,
  atlasBinCountWords,
  atlasBinDrawOffset,
  vsmAtlasBinWgsl,
} from './atlasBinWgsl.ts'
import { vsmAtlasRasterWgsl } from './atlasRasterWgsl.ts'
import { vsmRenderRasterWgsl } from '../../vsm/render/renderRasterWgsl.ts'
import { vsmRenderVoxelWgsl } from '../../vsm/render/renderVoxelWgsl.ts'

const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })

// The programs are assembled from blocks: a missing block, or one declared twice, throws here.
test("the atlas raster has the pool raster's entries, placed on the tile", () => {
  const code = vsmAtlasRasterWgsl(layout)
  for (const text of [
    'fn vsmRenderVs',
    'fn vsmRenderFs',
    'fn vsmAtlasPosition',
    '@builtin(frag_depth)',
  ])
    assert.ok(code.includes(text), text)
  assert.ok(!code.includes('vsmPoolAtomicMax'), 'the atlas raster joins nothing to the pool')
  assert.ok(!code.includes('vsmRenderPageOrigin(first'), 'and reads no page table')
  assert.equal(code.split('fn vsmAtlasTileOf').length, 2)
  assert.ok(
    !code.includes('vsmAtlasSkip') && !code.includes('ATLAS_PAGE'),
    'a pass is given its own records',
  )
})

test('the copies read and join the pool through the page table', () => {
  const into = vsmAtlasCopyInWgsl(layout)
  assert.ok(into.includes('fn vsmAtlasCopyFs') && into.includes('vsmPoolLoad('))
  const out = vsmAtlasCopyOutWgsl(layout)
  assert.ok(out.includes('fn vsmAtlasCopyOut') && out.includes('vsmPoolAtomicMax('))
})

test('the pool raster and its voxel rows lower the depth by the map’s draw bias, from the same words and formula as the atlas raster', () => {
  const functionsOnce = (code: string, name: string) => code.split(`fn ${name}`).length - 1
  const raster = vsmRenderRasterWgsl(layout)
  assert.ok(raster.includes('vsmAtlasBiasedClip(rawClip,record,raw,page,h,id)'))
  assert.equal(functionsOnce(raster, 'vsmAtlasBiasedClip'), 1)
  const voxel = vsmRenderVoxelWgsl(layout)
  for (const text of [
    'vsmDrawBiasOf(vsmRecordMap(record))',
    'vsmDrawNormal(cells[0].xyz,cells[1].xyz,cells[2].xyz,face)',
    'voxelDepth(in.depth,hit.t)-in.bias/(w*w)',
  ])
    assert.ok(voxel.includes(text), text)
  for (const code of [raster, voxel, vsmAtlasRasterWgsl(layout)]) {
    assert.equal(functionsOnce(code, 'vsmDrawLift'), 1)
    assert.ok(code.includes('@group(1) @binding(6) var<storage,read> vsmAtlas'))
  }
})

test('the second sort counts, lays out and scatters the records by tier and texture layer, and drops those no pass draws', () => {
  const code = vsmAtlasBinWgsl()
  for (const entry of ['vsmAtlasBinCount', 'vsmAtlasBinOffsets', 'vsmAtlasBinScatter'])
    assert.ok(code.includes(`fn ${entry}`), entry)
  assert.ok(code.includes('tile.page*ATLAS_LAYERS+layer'))
  assert.ok(code.includes('!tile.valid||vsmRecordMip(r)!=tile.mip'))
  assert.equal(atlasBinCountWords(3), 2 * ATLAS_BIN_TIERS.length * 3, 'counts then cursors')
  assert.equal(atlasBinDrawOffset(2, 1, 3), (2 * 3 + 1) * 16, 'four words a slot')
  // The voxel tiers are the pool raster's: the atlas tiers are the first of the list, so a tier's number is its place.
  assert.deepEqual(
    ATLAS_BIN_TIERS,
    ATLAS_BIN_TIERS.map((_, i) => i),
  )
})
