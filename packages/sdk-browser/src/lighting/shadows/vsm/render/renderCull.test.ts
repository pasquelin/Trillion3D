// The shadow raster's cull as shipped (`renderCullWgsl.ts`): the places of the records' list, shared
// by the records to draw and those the occlusion's first cull holds back, the windows of pages and the
// arguments of the second half.

import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { CULL } from './renderCullView.fixture.ts'
import { VSM_RENDER_ARGS_POST, VSM_RENDER_ARGS_WGSL } from './renderParamsWgsl.ts'

// The records to draw and those held back share one list and one count of its places
// (`vsmRenderTake`): from its head and from its end, never one place for two, every place asked
// counted. Three windows to draw and
// three records to hold in a list of four places, in either order.
test('the records to draw and those held back share the list’s places, every place counted', () => {
  const C = wgslConstants(CULL)
  const room = 4
  for (const holdsFirst of [false, true]) {
    const counts = new Array(64).fill(0),
      records = Array.from({ length: room }, () => [-1, -1, -1, -1])
    const cull = shaderRun<{
      vsmRenderEmit(...a: unknown[]): void
      vsmRenderHold(...a: unknown[]): void
    }>(CULL, ['vsmRenderEmit', 'vsmRenderHold'], {
      ...C,
      counts,
      records,
      params: { recordCapacity: room },
      vsmTableLevelOrigin: () => ({}),
      vsmTableEntryAt: () => ({}),
      vsmPageMarkWord: () => 0xffffffff,
    })
    // A rect of three pages a row, a window of one page each: three records to draw.
    const draw = () => cull.vsmRenderEmit(9, 0, 0, {}, 0, [0, 0, 2, 0], 1, 1)
    const hold = () => {
      for (let k = 0; k < 3; k++) cull.vsmRenderHold(100 + k, 5)
    }
    for (const step of holdsFirst ? [hold, draw] : [draw, hold]) step()
    const drawn = records.filter((r) => r[0] === 9).length,
      held = records.filter((r) => r[0] >= 100).length
    // One place for each, whoever asked first: none overwritten, none left empty.
    assert.equal(drawn + held, room, `holds first ${holdsFirst}: every place used once`)
    assert.equal(drawn, holdsFirst ? 1 : 3, `holds first ${holdsFirst}: the records drawn`)
    assert.equal(counts[C.VSM_RENDER_COUNT_TAKEN], 6, 'every place asked is counted')
    assert.equal(counts[C.VSM_RENDER_COUNT_HELD], held, 'the records held are the ones stored')
    // The held records lie where the second cull reads them, from the end.
    for (let i = 0; i < held; i++)
      assert.ok(records[room - 1 - i]![0]! >= 100, `holds first ${holdsFirst}: held ${i}`)
  }
})

// A window of the hardware raster is one record, its rect clipped to the pages whose flags hold the
// caster's layer, the pages between kept (the raster draws every page of the rect that is a page to
// draw): pages 1 and 3 of a row of four. The software raster's window, one page, gives a record each.
test('a window is one record clipped to the pages that match, whatever lies between', () => {
  const C = wgslConstants(CULL)
  const emit = (side: number) => {
    const records: number[][] = Array.from({ length: 8 }, () => [-1, -1, -1, -1])
    const run = shaderRun<{ vsmRenderEmit(...a: unknown[]): void }>(CULL, ['vsmRenderEmit'], {
      ...C,
      counts: new Array(64).fill(0),
      records,
      params: { recordCapacity: 8 },
      vsmTableLevelOrigin: () => ({}),
      vsmTableEntryAt: (_origin: unknown, _mip: number, page: number[]) => page,
      vsmPageMarkWord: (page: number[]) => (page[0] === 1 || page[0] === 3 ? 1 : 0),
    })
    run.vsmRenderEmit(9, 0, 0, { id: 3 }, 0, [0, 0, 3, 0], 1, side)
    return records.filter((r) => r[0] === 9)
  }
  assert.deepEqual(emit(C.VSM_RENDER_WINDOW_PAGES!), [[9, 0, 1 | (3 << 16), 0]])
  assert.deepEqual(emit(1), [
    [9, 0, 1 | (1 << 16), 0],
    [9, 0, 3 | (3 << 16), 0],
  ])
})

// After the first records are drawn, the argument kernel of the second half resets the list's places
// beside the records held back and sizes the post cull over the casters found since the descent's
// post pass opened, a group of lanes each and a z for each listed map.
test('the second half’s arguments size the post cull over the casters found since the post pass opened', () => {
  const C = wgslConstants(VSM_RENDER_ARGS_WGSL)
  const argsFor = (casters: number, first: number) => {
    const counts = new Array(64).fill(0),
      args = new Array(64).fill(-1)
    counts[0] = casters
    counts[C.VSM_RENDER_COUNT_CAST_FIRST] = first
    counts[C.VSM_RENDER_COUNT_VIEWS] = 3
    counts[C.VSM_RENDER_COUNT_HELD] = 130
    shaderRun<{ vsmRenderArgsSecond(): void }>(VSM_RENDER_ARGS_WGSL, ['vsmRenderArgsSecond'], {
      ...C,
      counts,
      args,
      params: { viewCount: 5 },
    }).vsmRenderArgsSecond()
    return { counts, post: args.slice(VSM_RENDER_ARGS_POST, VSM_RENDER_ARGS_POST + 3) }
  }
  const found = argsFor(100, 40)
  assert.deepEqual(found.post, [1, 1, 3], '60 casters: a group, three lights')
  assert.equal(found.counts[C.VSM_RENDER_COUNT_TAKEN], 130, 'the places start beside the held')
  assert.deepEqual(argsFor(40, 40).post.slice(2), [0], 'none found: no light, nothing dispatched')
})
