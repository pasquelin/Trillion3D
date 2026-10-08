// A pool place on the GPU (`texture/tiles.ts`, `webgpu/tile/wgsl.ts`): the place a table word
// names — column, row, and a layer up to the last a pool may take, past the 255 an 8-bit field held
// — is the one the atlas reads decode, for a streamed tile's entry and for a texture's tail word;
// and on a real pool, the tap the shader builds from it samples the very texel the streamer wrote
// at that cell (`cellOrigin`). A device grants the adapter's array layers, so a lane may take them.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/pool-place.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  packEntry,
  packPlace,
  POOL_LAYER_SIDE,
  POOL_MAX_LAYERS,
  TILE_BORDER,
  type TilePlace,
} from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { TILE_POOL_WGSL } from '../../../packages/sdk-browser/src/webgpu/tile/wgsl.ts'
import { cellOrigin } from '../../../packages/sdk-browser/src/webgpu/tile/write.ts'
import { computeOnDawn } from '../kit/computeRun.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** The atlas reads' place decode and pool tap, taken from the shipped text itself. */
function poolLines() {
  const wanted =
    /^(const (TEXEL_PITCH|TEXEL_BORDER|POOL_SUBTEXEL|POOL_STEP):.*|struct TileTap\{.*|fn (poolAxis|poolTap|placeOrigin|placeLayer)\(.*)$/gm
  const lines = TILE_POOL_WGSL.text.match(wanted) ?? []
  assert.equal(lines.length, 9, `the pool text no longer declares its place decode:\n${lines}`)
  return lines.join('\n')
}

const proofWgsl = () => `${poolLines()}
@group(0) @binding(0) var<storage,read> words:array<u32>;
@group(0) @binding(1) var<storage,read> texels:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> places:array<vec4f>;
@group(0) @binding(3) var pool:texture_2d_array<f32>;
@group(0) @binding(4) var nearest:sampler;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=arrayLength(&words)){return;}
 let w=words[i];
 let t=poolTap(placeOrigin(w),texels[i],placeLayer(w));
 var read=-1.0;
 if(t.layer<i32(textureNumLayers(pool))){read=textureSampleLevel(pool,nearest,t.uv,t.layer,0.0).r;}
 places[i]=vec4f(placeOrigin(w),f32(placeLayer(w)),read);
}`

/** Columns and rows at the grid's corners and inside, on layers either side of each field edge. */
function placeCases() {
  const cells = [
    [0, 0],
    [29, 0],
    [0, 29],
    [29, 29],
    [17, 5],
  ]
  const layers = [0, 1, 255, 256, 257, 1000, 2047, 2048, POOL_MAX_LAYERS - 1]
  return layers.flatMap((layer) => cells.map(([x, y]): TilePlace => ({ x, y, layer })))
}

/** The pool's inputs on `device`: the words, the in-cell texels, a two-layer pool holding
 *  `writes` (column, row, layer, value) and a nearest sampler. */
const poolInputs =
  (words: number[], texels: number[], writes: number[][]) => (device: GPUDevice) => {
    const pool = device.createTexture({
      size: [POOL_LAYER_SIDE, POOL_LAYER_SIDE, 2],
      format: 'r8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    for (const [x, y, layer, value] of writes)
      device.queue.writeTexture(
        { texture: pool, origin: [x, y, layer] },
        Uint8Array.of(value),
        {},
        [1, 1],
      )
    return [
      Uint32Array.from(words),
      Float32Array.from(texels),
      pool.createView({ dimension: '2d-array' }),
      device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' }),
    ]
  }

test('a place up to the last pool layer decodes on the GPU as packed, and its tap samples its cell', async () => {
  const places = placeCases()
  // Each place twice: a streamed tile's entry, then a tail word as its slot reads it (24 bits).
  const words = [
    ...places.map((place) => packEntry(place, 15)),
    ...places.map((place) => ((packPlace(place) | (3 << 24)) >>> 0) & 0xffffff),
  ]
  // In-cell texel centres; the places of the first two layers get a distinct value there.
  const inCell = (n: number) => [(n * 37) % 128, (n * 59) % 128]
  const texels = words.flatMap((_, n) => inCell(n).map((t) => t + 0.5))
  const writes: number[][] = []
  const expected = words.map((_, n) => {
    const place = places[n % places.length],
      [ox, oy] = cellOrigin(place).map((o) => o + TILE_BORDER)
    if (place.layer > 1) return -1
    const [tx, ty] = inCell(n),
      value = 1 + (n % 254)
    writes.push([ox + tx, oy + ty, place.layer, value])
    return value
  })
  // Every word decoded on the GPU, with the pool texel its tap samples.
  const {
    adapter,
    errors,
    values: read,
  } = await computeOnDawn(proofWgsl(), words.length * 16, ceilDiv(words.length, 64), {
    setup: poolInputs(words, texels, writes),
    output: 2,
  })
  console.log(JSON.stringify({ adapter, words: words.length }))
  assert.deepEqual(errors, [])
  words.forEach((_, n) => {
    const place = places[n % places.length]
    const [ox, oy] = cellOrigin(place).map((o) => o + TILE_BORDER)
    const got = read.slice(n * 4, n * 4 + 4)
    const name = `${n < places.length ? 'entry' : 'tail'} ${JSON.stringify(place)}`
    assert.deepEqual(got.slice(0, 3), [ox, oy, place.layer], `${name}: decoded place`)
    if (expected[n] >= 0)
      assert.equal(Math.round(got[3] * 255), expected[n], `${name}: the tap samples its own cell`)
  })
})
