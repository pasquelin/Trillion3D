// The virtual shadow map views' projection: the two kernels assemble, keep the page their last ray read, draw each mode as its reference does,
// and leave the projection's own programs as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VIRTUAL_SHADOW_MAP_VIEWS } from '../../../../../../sdk-core/src/runtime/diagnostics.ts'
import { functionsOf } from '../../../../materials/texture/shaderRule.fixture.ts'
import { assertProgramAssembles } from '../../../../gpu/core/wgslNames.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { cachedPageLegend, viewTitle } from '../debug/visualizeView.ts'
import { vsmLocalsProjectionWgsl, vsmSunsProjectionWgsl } from './projectionWgsl.ts'
import { vsmVisualizeRequest } from './visualizePass.ts'
import { vsmIntToColor, vsmVirtualPageColor } from '../debug/pageColorWgsl.ts'
import {
  modeConstant,
  VSM_VISUALIZE_OUTPUT_WGSL,
  VSM_VISUALIZE_RAY_COLOR_WGSL,
  vsmVisualizeLocalsWgsl,
  vsmVisualizeSunsWgsl,
} from './visualizeWgsl.ts'

const LAYOUT = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })
const SUNS = vsmVisualizeSunsWgsl(LAYOUT)
const LOCALS = vsmVisualizeLocalsWgsl(LAYOUT)

test('the views’ kernels are programs a device takes, and name no word of the engine’s rules out', () => {
  assertProgramAssembles(SUNS, 'vsmVisualizeSuns', 'the suns’ kernel')
  assertProgramAssembles(LOCALS, 'vsmVisualizeLocals', 'the local lights’ kernel')
  assertProgramAssembles(vsmVisualizeSunsWgsl(LAYOUT, true), 'vsmVisualizeSuns', 'with subgroups')
  assertProgramAssembles(
    vsmVisualizeLocalsWgsl(LAYOUT, true),
    'vsmVisualizeLocals',
    'with subgroups',
  )
  // What these files write: no backtick in the text, none of the reference’s names.
  for (const code of [
    VSM_VISUALIZE_OUTPUT_WGSL.text,
    VSM_VISUALIZE_RAY_COLOR_WGSL.text,
    vsmIntToColor.text,
    vsmVirtualPageColor.text,
  ]) {
    assert.doesNotMatch(code, /`/)
    assert.doesNotMatch(code, /unreal|epic|lumen|nanite|substrate|megalights/i)
  }
})

test('the suns’ kernel adds the suns in the order of their records, and the locals’ adds the lights of the pixel’s cell to that sum', () => {
  const suns = functionsOf(SUNS, ['vsmVisualizeSuns'])
  assert.match(suns, /for\(var k=0u;k<vsmView\.sunCount;k\+\+\)\{/)
  assert.match(suns, /vsmSeen\.map=NO_INDEX;/)
  assert.match(suns, /colour=vsmVisualizeOutput\(k,r,colour,true\);/)
  assert.equal(suns.match(/textureStore\(/g)?.length, 1)
  const locals = functionsOf(LOCALS, ['vsmVisualizeLocals'])
  assert.match(locals, /colour=textureLoad\(vsmVizIn,pixel\.pos,0\);/)
  assert.match(locals, /list=vsmShadowedList\(pixelCell\(/)
  assert.match(locals, /if\(listed\)\{colour=vsmVisualizeOutput\(k,r,colour,false\);\}/)
  // A group with no light to walk keeps the suns’ colour.
  assert.equal(locals.match(/textureStore\(vsmVizOut,pixel\.pos,colour\);/g)?.length, 2)
  // The tables of the stage: the page records join, the counters and the lights’ tile lists go.
  assert.match(SUNS, /vsmPoolPageInfo/)
  assert.doesNotMatch(SUNS + LOCALS, /vsmStats|tileLights/)
})

test('each mode id is one bit, and a constant of the output function', () => {
  const ids = Object.values(VIRTUAL_SHADOW_MAP_VIEWS)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.equal(id & (id - 1), 0)
  for (const [view, id] of Object.entries(VIRTUAL_SHADOW_MAP_VIEWS))
    assert.match(SUNS, new RegExp(`const ${modeConstant(view)}:u32=${id}u;`))
})

test('the output function draws each mode with the reference’s weights', () => {
  const out = functionsOf(SUNS, ['vsmVisualizeOutput'])
  // One light shown alone and in full, else a quarter of each light added.
  assert.match(out, /if\(one&&u32\(vsmViz\.light\)!=k\)\{return accumulator;\}/)
  assert.match(out, /if\(r\.rayCount==0u\)\{return accumulator;\}/)
  assert.match(
    out,
    /output=mix\(vec4f\(0\.0,0\.0,0\.5,1\.0\),vec4f\(1\.0,1\.0,0\.0,1\.0\),r\.shadowFactor\);/,
  )
  assert.match(out, /output\.b=min\(output\.b,0\.12\);/)
  assert.match(out, /0\.8\*vsmIntToColor\(level\)\+0\.2\*shadow/)
  assert.match(out, /0\.4\*pageColor\+0\.4\*vsmIntToColor\(level\)\+0\.2\*shadow/)
  assert.match(out, /accumulator\.xy\+vec2f\(f32\(r\.rayCount\),f32\(rayMost\)\)/)
  assert.match(out, /select\(0\.25,0\.9,one\)/)
  assert.match(out, /output=vec4f\(rgb\+accumulator\.rgb,0\.9\);/)
  assert.match(out, /mix\(color,dirtyColor,0\.8\)/)
  assert.match(out, /0\.55\*cacheColor\+0\.25\*vsmGrayscale\(pageColor\)\+0\.2\*shadow/)
  // The distance to the occluder, 2000 cm to white, in the metres of the trace.
  assert.match(out, /r\.occluderDistance\/20\.0+/)
  // A mode that draws nothing leaves the pixel as it was.
  assert.match(out, /if\(output\.a>0\.0\)\{return output;\}\n return accumulator;/)
})

test('the page state words are the pool’s own for the reference’s', () => {
  const out = functionsOf(SUNS, ['vsmVisualizeOutput'])
  assert.match(out, /pageFlags&VSM_PAGE_DYNAMIC_STALE/)
  assert.match(out, /pageFlags&VSM_PAGE_STATIC_STALE/)
  assert.match(out, /pageFlags&VSM_META_FORCE_CACHED/)
  assert.match(out, /pageFlags&VSM_META_STATIC_DRAWN/)
  assert.match(out, /pageFlags&VSM_META_DYNAMIC_DRAWN/)
  assert.match(out, /pageFlags&VSM_META_STATIC_STALE/)
  assert.match(out, /pageFlags&VSM_META_DYNAMIC_STALE/)
})

test('the trace keeps its last ray’s page only for the views; the projection’s own programs are as they were', () => {
  const trace = functionsOf(SUNS, ['vsmRayTexel', 'vsmRayBegin'])
  assert.match(
    trace,
    /vsmSeen=VsmSeen\(t\.levelHandle\.id,u32\(vsmProjectionData\[t\.levelHandle\.id\]\.mapLevel\),t\.mapTexelXY,t\.poolTexel\);/,
  )
  assert.match(trace, /vsmSeen=VsmSeen\(h\.id,mip,page\.mapTexelXY,page\.poolTexel\);/)
  assert.match(trace, /vsmSeen\.map=NO_INDEX;/)
  for (const code of [vsmSunsProjectionWgsl(LAYOUT), vsmLocalsProjectionWgsl(LAYOUT, 'rg32uint')]) {
    assert.doesNotMatch(code, /vsmSeen|VsmSeen|vsmViz/)
    assert.match(code, /return vsmClipmapTexel\(h,\(\*ray\)\.pages\.page,uv\);/)
  }
})

test('the request: a view’s mode id with the settings that shape it, none for another mode', () => {
  const settings = { shadowVisualizeLight: -1, shadowVisualizeCachedPagesOnly: false }
  assert.deepEqual(vsmVisualizeRequest('virtual-shadow-map-cached-page', settings), {
    mode: 8,
    light: -1,
    cachedOnly: false,
  })
  assert.deepEqual(
    vsmVisualizeRequest('virtual-shadow-map-ray-count', { ...settings, shadowVisualizeLight: 2 }),
    { mode: 16, light: 2, cachedOnly: false },
  )
  assert.equal(vsmVisualizeRequest('virtual-shadow-map-clipmap-virtual-space', settings), undefined)
  assert.equal(vsmVisualizeRequest('shadows', settings), undefined)
  assert.equal(vsmVisualizeRequest(undefined, settings), undefined)
})

test('the legends: the views’ titles, and the cached-page entries by light and by the kept-pages setting', () => {
  assert.equal(viewTitle('virtual-shadow-map-gpu-invalidated-page'), 'Gpu Invalidated Page')
  const labels = (one: boolean, only: boolean) =>
    cachedPageLegend(one, only).map(([label]) => label)
  assert.deepEqual(labels(false, false), ['All Invalidated', 'Dynamic Invalidated', 'Force cached'])
  assert.deepEqual(labels(true, false), [
    'Cached',
    'All Invalidated',
    'Dynamic Invalidated',
    'Force cached',
  ])
  assert.deepEqual(labels(false, true), ['Cached'])
})
