// The compact mask: a light's 8-bit lane holds its trace's count, and the resolve decodes
// it to the factor the rgba16float channel held. The shipped WGSL is run: every result a trace
// can give — no ray (1), k of n rays, n up to the ray counts — codes to one byte whose table entry
// is computed by the same f32 expression, bit for bit, as the factor the projection stored; the
// table goes through the same rgba16float store the mask did, so each decoded factor is the half
// float it was. Four lanes share a word without touching each other.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { VSM_MASK_TABLE_WGSL, vsmProjectionWgsl } from './projectionWgsl.ts'
import { createVsmMaskTable, VSM_MASK_TABLE_READ_WGSL } from './projectionMaskTable.ts'
import { directShadowWgsl } from '../lighting/direct/shadowWgsl.ts'
import { createDeferredPlaceholders } from '../lighting/deferred/setup.ts'
import { VSM_TRACE_RAYS_SUN, VSM_TRACE_RAYS_LOCAL } from './constants.ts'
import { vsmLayout } from './layout.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

const f = Math.fround
const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27), {
  subgroups: false,
})
type Result = { valid: boolean; shadowFactor: number; rayCount: number }
const { vsmMaskCode } = shaderRun<{ vsmMaskCode: (r: Result) => number }>(CODE, ['vsmMaskCode'], {})
const { vsmMaskTableValue } = shaderRun<{ vsmMaskTableValue: (c: number) => number }>(
  VSM_MASK_TABLE_WGSL,
  ['vsmMaskTableValue'],
  {},
)
/** Every result a trace gives: no ray traced (factor 1), or k of n rays missed. */
function* results() {
  yield { valid: false, shadowFactor: 1, rayCount: 0 }
  const most = Math.max(VSM_TRACE_RAYS_SUN, VSM_TRACE_RAYS_LOCAL, 8)
  for (let n = 1; n <= most; n++)
    for (let k = 0; k <= n; k++) yield { valid: true, shadowFactor: f(f(k) / f(n)), rayCount: n }
}

test('a lane holds four bits of rays: every ray count the traces use fits', () => {
  assert.ok(Math.max(VSM_TRACE_RAYS_SUN, VSM_TRACE_RAYS_LOCAL) <= 15)
})

test('the table computes a factor by the very expression the traces store', () => {
  // The same f32 division of the same two counts on the same device: the same f32, then the same
  // rgba16float store as the mask's.
  assert.equal(CODE.match(/shadowFactor=f32\(missCount\)\/f32\(rayCount\);/g)?.length, 2)
  assert.match(VSM_MASK_TABLE_WGSL, /return f32\(missCount\)\/f32\(rayCount\);/)
  assert.match(VSM_MASK_TABLE_WGSL, /texture_storage_2d<rgba16float,write>/)
})

test('every factor a trace stores codes to one byte the table turns back into it, bit for bit', () => {
  const codes = new Set<number>()
  for (const r of results()) {
    const code = vsmMaskCode(r)
    assert.ok(code >= 0 && code < 256 && Number.isInteger(code), `${code}`)
    assert.equal(f(vsmMaskTableValue(code)), r.shadowFactor, `${r.shadowFactor} of ${r.rayCount}`)
    codes.add(code)
  }
  assert.equal(
    codes.size,
    [...results()].length,
    'one code a result: no two counts share a lane value',
  )
})

test('four lanes in a word: each light reads its own; a layer its tile did not store is not read, and reads lit', () => {
  const table = new Map<number, number>()
  const lanes = [0, (7 << 4) | 3, (1 << 4) | 1, (5 << 4) | 2]
  const word = lanes.reduce((w, code, k) => (w | (code << (8 * k))) >>> 0, 0)
  let loads = 0,
    tileLoads = 0
  const resolve = wgslModule(directShadowWgsl(25, { resolveTransmission: 14 }))
  const K = wgslConstants(resolve)
  const scope = {
    ...K,
    vsmShadowMask: 'mask',
    vsmShadowMaskTiles: 'tiles',
    // Layer 0 stored in the pixel's tile, layer 1 not: the tile word names a layer of the mask.
    textureLoad: (texture: string) =>
      texture === 'tiles' ? (tileLoads++, [0b1, 0, 0, 0]) : (loads++, [word, 0, 0, 0]),
    vsmMaskPixel: [0, 0],
    vsmMaskLayer: 0xffffffff,
    vsmMaskWord: 0,
    // As the pixel's setup leaves it (\`vsmMaskAt\`): the word unread.
    vsmMaskTile: K.VSM_MASK_TILE_UNREAD,
    vsmMaskDecode: (code: number) => (table.set(code, 1), f(vsmMaskTableValue(code))),
  }
  const { vsmMaskFactor } = shaderRun<{ vsmMaskFactor: (channel: number) => number }>(
    resolve,
    ['vsmMaskFactor'],
    scope,
  )
  assert.deepEqual([0, 1, 2, 3].map(vsmMaskFactor), [1, f(f(3) / f(7)), 1, f(f(2) / f(5))])
  assert.deepEqual([...table.keys()], lanes)
  assert.equal(loads, 1, 'one load of the layer for its four lights')
  for (const channel of [4, 8, 63])
    assert.equal(vsmMaskFactor(channel), 1, `light ${channel}: its layer unstored, read lit`)
  assert.equal(loads, 1, 'and never loaded')
  assert.equal(tileLoads, 1, 'the tile word loaded once, by the first light that reads the mask')
  // A pixel no shadow setup reached reads no layer: the tile word starts empty; its setup loads
  // nothing, a pixel none of whose lights reads the mask loading no word.
  assert.match(resolve, /var<private> vsmMaskTile:u32=0u;/)
  assert.match(
    resolve,
    /fn vsmMaskAt\(coord:vec2i\)\{\n vsmMaskPixel=coord;vsmMaskLayer=0xffffffffu;vsmMaskTile=VSM_MASK_TILE_UNREAD;\n\}/,
  )
  assert.ok(resolve.includes('textureLoad(vsmShadowMaskTiles,vsmMaskPixel>>vec2u(3u),0).r'))
  assert.doesNotMatch(resolve, /textureNumLayers\(vsmShadowMask\)/)
  assert.match(resolve, /var vsmShadowMask:texture_2d_array<u32>;/)
  assert.ok(resolve.includes(VSM_MASK_TABLE_READ_WGSL.text))
})

test('the table compiles off the frame from its creation, then fills once, by one group, in its own submit', async () => {
  const { device } = fakeDevice()
  const made: string[] = [],
    dispatched: number[][] = [],
    submitted: unknown[][] = []
  const create = device.createComputePipeline.bind(device),
    createAsync = device.createComputePipelineAsync.bind(device)
  device.createComputePipeline = (d) => (made.push('at once'), create(d))
  device.createComputePipelineAsync = (d) => (made.push('off the frame'), createAsync(d))
  device.createCommandEncoder = () =>
    ({
      beginComputePass: () => ({
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups: (...g: number[]) => void dispatched.push(g),
        end() {},
      }),
      finish: () => 'table',
    }) as unknown as GPUCommandEncoder
  device.queue.submit = (buffers) => void submitted.push([...buffers])
  const table = createVsmMaskTable(device)
  assert.equal(table.texture.format, 'rgba16float')
  assert.deepEqual([table.texture.width, table.texture.height], [64, 1])
  await new Promise(setImmediate)
  table.fill()
  table.fill()
  assert.deepEqual(made, ['off the frame'])
  assert.deepEqual(dispatched, [[1]], 'once')
  assert.deepEqual(submitted, [['table']], 'its own submit: no frame encoder dropped loses it')
  assert.match(VSM_MASK_TABLE_WGSL, /@workgroup_size\(64\)/)
})

test('a device without compute pipelines still makes the lighting stand-ins: none compiled at once', () => {
  const { device } = fakeDevice({ compute: false })
  createDeferredPlaceholders(device).dispose()
})
