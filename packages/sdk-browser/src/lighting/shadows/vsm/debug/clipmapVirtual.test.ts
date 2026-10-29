import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../layout.ts'
import { clipmapVirtualSpaceWgsl } from './clipmapVirtual.ts'

const code = clipmapVirtualSpaceWgsl(vsmLayout({ fullMapCapacity: 0, coverMode: 'none' }))

test('the view reads the maps’ records, the page table and the allocated rects, and draws two fragment stages', () => {
  for (const name of ['vsmProjectionData', 'vsmMappedRects', 'vsmPageTableLoad'])
    assert.match(code, new RegExp(name))
  assert.match(code, /fn fsClipmapDesaturate\(/)
  assert.match(code, /fn fsClipmapVirtualSpace\(/)
  assert.doesNotMatch(code.slice(code.indexOf('struct ClipmapView')), /`/)
})

test('the zoom fits the finest level’s allocated pages, widened by the coarser levels’ rects, and the colour mixes the level three parts in four', () => {
  assert.match(code, /bounds\.x<=bounds\.z&&bounds\.y<=bounds\.w/)
  assert.match(code, /zoom=max\(zoom,fit\/f32\(1u<<u32\(deepest-i\)\)\)/)
  assert.match(code, /,0\.75\)/)
})
