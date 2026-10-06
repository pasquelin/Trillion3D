// The tile depths the sun's first-ray proof reads (`tileDepths`): the pages whose slice 0
// changed this frame are listed (`vsmFoldRasterMarks`), and each listed
// page's 8×8 tiles get their greatest word whose float is not below 0 or NaN
// (`vsmTileDepthsBuild`), the shipped kernels run lane by lane over a made-up pool
// (`projectionEarlyOut.fixture.ts`).
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { earlyOutWorld } from './projectionEarlyOut.fixture.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { VSM_LOG2_PAGE } from './constants.ts'
import { vsmLayout } from './layout.ts'

test('the build kernel writes each tile the greatest word whose float is not below 0', () => {
  // `vsmTileDepthsBuild` run lane by lane, twice: every lane's atomicMax, then the 16
  // stores again of the whole tiles — a max repeated is the same max.
  const world = earlyOutWorld(9),
    list = [3, 129, 4095],
    stored = new Map<number, number>()
  const tiles = Array.from({ length: 16 }, () => 0)
  const code = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7, poolPages: 4096 }, 2 ** 27))
    .tileDepthsBuild.code
  // The tile setup's constants, which the WGSL derives: 32×32 texels a group, 16 groups a page.
  const tilesXY = VSM_LOG2_PAGE - 5
  const scope = {
    ...world.scope,
    ...wgslConstants(code),
    PM_LOG2_TILES_ACROSS: tilesXY,
    PM_LOG2_TILES: 2 * tilesXY,
    PM_TILES: 1 << (2 * tilesXY),
    PM_TILES_ACROSS_MASK: (1 << tilesXY) - 1,
    PM_TILES_MASK: (1 << (2 * tilesXY)) - 1,
    pmTileDepth: tiles,
    workgroupBarrier: () => {},
    vsmPagesForTilesLoad: (i: number) => list[i],
    vsmTileDepthsStore: (k: number, w: number) => void stored.set(k, w),
    vsm: { poolPages: 4096, poolRowShift: 7, poolRowMask: 127 },
  }
  const { vsmTileDepthsBuild } = shaderRun<{
    vsmTileDepthsBuild: (id: number[], lane: number, wid: number[]) => void
  }>(
    code,
    [
      'vsmTileDepthsBuild',
      'pmTileDepthWord',
      'pmTileDepthOf2x2',
      'pmGroupIndex',
      'pmTileOf',
      'pmTileOffset',
      'vsmPoolPageOf',
      'vsmTileDepthIndex',
      'vsmPoolIndexOf',
    ],
    scope,
  )
  for (let page = 0; page < list.length; page++)
    for (let group = 0; group < 16; group++) {
      tiles.fill(0)
      const wid = [group, page, 0]
      for (let pass = 0; pass < 2; pass++)
        for (let lane = 0; lane < 256; lane++)
          vsmTileDepthsBuild([lane & 15, lane >> 4, 0], lane, wid)
    }
  assert.equal(stored.size, list.length * 256)
  // The words the proof's world reads: its texels' greatest whose float is not below 0.
  for (const [k, word] of stored) assert.equal(word, world.tileDepth(k), `tile ${k}`)
})

test("the pages whose slice 0 changed are listed: allocated, dirty static or dynamic, referenced, a sun's", () => {
  const code = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7, poolPages: 512 }, 2 ** 27))
    .foldRasterMarks.code
  const C = wgslConstants(code)
  const ALLOCATED = C.VSM_PAGE_WANTED,
    DYNAMIC = C.VSM_META_DYNAMIC_DRAWN,
    STATIC = C.VSM_META_STATIC_DRAWN,
    UNREFERENCED = C.VSM_META_UNSEEN
  const flags = [
    ALLOCATED | DYNAMIC,
    ALLOCATED | STATIC,
    ALLOCATED | DYNAMIC | STATIC,
    ALLOCATED,
    DYNAMIC,
    ALLOCATED | DYNAMIC | UNREFERENCED,
    0,
    ALLOCATED | DYNAMIC,
  ]
  // Page 7's map is a local light's (light type 1), the others the sun's (0).
  const mapOf = (page: number) => (page === 7 ? 9 : 8)
  const args = [16, 0, 1, 0],
    listed: number[] = []
  const { vsmFoldRasterMarks } = shaderRun<{
    vsmFoldRasterMarks: (id: number[]) => void
  }>(code, ['vsmFoldRasterMarks'], {
    ...C,
    vsm: { poolPages: flags.length },
    pmFoldMarks: (page: number) => flags[page],
    vsmPoolPageInfo: flags.map((_, page) => ({ mapId: mapOf(page) })),
    vsmProjectionData: { 8: { lightKind: 0 }, 9: { lightKind: 1 } },
    vsmCount: () => {},
    vsmTileArgs: args,
    vsmPagesForTilesStore: (slot: number, page: number) => void (listed[slot] = page),
    vsmMergeArgs: [16, 0, 1, 0],
    vsmPagesToMergeStore() {},
  })
  for (let page = 0; page <= flags.length; page++) vsmFoldRasterMarks([page])
  assert.deepEqual(listed, [0, 1, 2])
  assert.deepEqual(args, [16, 3, 1, 0], '16 groups a listed page')
})

// Defect this catches: a pass that came to write slice 0 without marking its pages dirty would leave
// their tile depths below their texels, and the first-ray proof would accept rays the march hits.
// The pool's writers are the three whose pages the selection lists: the initialisation (its pages
// marked dynamic-drawn with it, `vsmListClears`), the raster (each page it draws marked,
// `vsmRenderExpand`) and the merge (of the static-drawn pages). A new writer fails here until it
// marks its pages so.
test("the pool's writers are the three that mark their pages dirty", () => {
  const writers: string[] = []
  for (const file of readdirSync(new URL('.', import.meta.url))) {
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file)) continue
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const [spec] of text.matchAll(/\{ resource: 'pagePool'[^}]*\}/g))
      if (/access: '(read_write|atomic)'/.test(spec)) writers.push(file)
  }
  assert.deepEqual(writers.sort(), [
    'physicalPagesWgsl.ts',
    'physicalPagesWgsl.ts',
    'renderRasterWgsl.ts',
  ])
  const kernels = vsmPhysicalPageKernels(vsmLayout({ fullMapCapacity: 7 }, 2 ** 27))
  const own = Object.values(kernels)
    .filter((k) => k.specs.some((s) => s.resource === 'pagePool' && s.access === 'read_write'))
    .map((k) => k.label)
  assert.deepEqual(own.sort(), ['ClearPages', 'MergeStatic'])
})
