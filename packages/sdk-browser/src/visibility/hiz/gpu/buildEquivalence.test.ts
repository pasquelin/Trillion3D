import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_IMAGE_LEVEL0, HIZ_SHADER, hizBuildShader } from './shader.ts'
import { hizWorkSource } from './workDepthSource.ts'
import { HIZ_BUILD_SIDE, HIZ_MAX_LEVELS, HIZ_PASS_LEVELS, hizBuildPasses } from './uniforms.ts'
import { buildAfter, buildBefore } from './buildTranscripts.fixture.ts'
import { layout, type Scene } from './buildScene.fixture.ts'
import { hizLevelSizes } from './levelSizes.ts'
import { HIZ_WHOLE_FARTHEST } from './pyramidTexture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'

// The reference pyramid build is one dispatch per mip, the first reading the level-0 texture, each
// further one the level above from the pyramid. `buildHiz` reads the texture once, copies nothing
// and reduces four mips per dispatch through workgroup memory. Below, both transcribed line by
// line, driven by the uniform words the host really writes, must leave the pyramid identical bit
// for bit — every texel written, no other — on random sizes, capped mip counts, and NaN, ±0, ±Inf
// depths: the culling layer, alone or with the nearest, its maximum, and the finished depth's
// farthest layers beside it.

const SPECIALS = [0, -0, 1, Infinity, -Infinity, Number.NaN]

function scene(rand: () => number, hostile: boolean): Scene {
  const pick = (n: number) => 1 + Math.floor(rand() * n)
  const width = rand() < 0.2 ? pick(3) : pick(140),
    height = rand() < 0.2 ? pick(3) : pick(140)
  const depth = () =>
    hostile && rand() < 0.05 ? SPECIALS[Math.floor(rand() * SPECIALS.length)] : rand()
  const texture = Float32Array.from({ length: width * height }, depth)
  const maxLevels = rand() < 0.2 ? pick(6) : HIZ_MAX_LEVELS
  // The trace layers reduce another depth than the culling layer where a transparent surface folds in.
  const folded = rand() < 0.5 ? Float32Array.from(texture, (z) => Math.max(z, rand())) : undefined
  return { texture, width, height, maxLevels, trace: rand() < 0.5, planes: rand() < 0.5, folded }
}

function assertSamePyramid(s: Scene, rand: () => number, label: string) {
  const { words } = layout(s)
  // The same garbage on both sides: a texel one side writes and the other does not shows.
  const garbage = () => Float32Array.from({ length: words + 8 }, (_, i) => -1000 - i)
  const before = { cull: garbage(), nearest: garbage(), whole: garbage() }
  const after = { cull: garbage(), nearest: garbage(), whole: garbage() }
  buildBefore(s, before)
  buildAfter(s, after, rand)
  for (const layer of ['cull', 'nearest', 'whole'] as const)
    assert.deepEqual(
      new Uint32Array(after[layer].buffer),
      new Uint32Array(before[layer].buffer),
      `${label}, the ${layer} layer`,
    )
}

for (const [seed, hostile, trials] of [
  [5, false, 300],
  [17, true, 150],
] as const)
  test(`same pyramid, bit for bit, seed ${seed}${hostile ? ', with NaN, ±0 and ±Inf depths' : ''}`, () => {
    const rand = lcgRandom(seed)
    for (let trial = 0; trial < trials; trial++)
      assertSamePyramid(scene(rand, hostile), rand, `trial ${trial}`)
  })

test('edge sizes: one texel, one row, one column, a tile edge, 1080p, a capped mip count', () => {
  const rand = lcgRandom(3)
  const sizes: Array<[number, number, number]> = [
    [1, 1, HIZ_MAX_LEVELS],
    [1, 37, HIZ_MAX_LEVELS],
    [37, 1, HIZ_MAX_LEVELS],
    [16, 16, HIZ_MAX_LEVELS],
    [17, 33, HIZ_MAX_LEVELS],
    [128, 128, HIZ_MAX_LEVELS],
    [1920, 1080, HIZ_MAX_LEVELS],
    [300, 200, 2],
  ]
  for (const [width, height, maxLevels] of sizes)
    for (const trace of [false, true]) {
      const texture = Float32Array.from({ length: width * height }, () => rand())
      assertSamePyramid(
        { texture, width, height, maxLevels, trace },
        rand,
        `${width}×${height}${trace ? ', with the trace layers' : ''}`,
      )
      // The closest depth of each centre: the nearest layer alone, the finished depth's farthest
      // layer left as it was.
      if (trace)
        assertSamePyramid(
          { texture, width, height, maxLevels, trace, planes: false },
          rand,
          `${width}×${height}, trace without the planes`,
        )
    }
  // 1080p: twelve mips in three dispatches, where the per-level build took twelve.
  assert.deepEqual(
    hizBuildPasses(hizLevelSizes(1920, 1080)).map(({ source, levels }) => [source, levels]),
    [
      [0, 4],
      [4, 4],
      [8, 3],
    ],
  )
  assert.deepEqual(hizBuildPasses([[1, 1]]), [{ source: 0, width: 1, height: 1, levels: 0 }])
})

test('the shipped build is one kernel over workgroup memory, copying nothing of level 0', () => {
  assert.match(
    HIZ_SHADER,
    new RegExp(`var<workgroup> hizTile:array<vec3f,${HIZ_BUILD_SIDE * HIZ_BUILD_SIDE}>;`),
  )
  assert.match(
    HIZ_SHADER,
    new RegExp(`@workgroup_size\\(${HIZ_BUILD_SIDE}, ${HIZ_BUILD_SIDE}\\)\\s*fn buildHiz\\(`),
  )
  assert.match(HIZ_SHADER, new RegExp(`dst:array<vec4u,${HIZ_PASS_LEVELS}>,`))
  assert.doesNotMatch(HIZ_SHADER, /fn copyDepth|fn reduceHiz/)
  // The lines the transcript follows, pinned: a slip in the WGSL alone shows here.
  const build = HIZ_SHADER.slice(HIZ_SHADER.indexOf('fn hizSource'))
  for (const line of [
    'select(cell*2u,min(cell*2u,max(size,2u)-2u),fromDepth)',
    'let x0=hizSquareStart(x,hizUni.b,at==0u);let y0=hizSquareStart(y,hizUni.c,at==0u);',
    'if(hizUni.a!=0u){return hizLoadBound(i);}',
    'return vec3f(cull,corners.x,corners.y);',
    'return vec3f(cull,hizFrontOf(q,opaque),0.0);',
    'if(hizUni.d>0u){hizPutBound(hizUni.dst[0].x+y*hizUni.dst[0].y+x,bound);}',
    `for(var k=1u;k<min(hizUni.d,${HIZ_PASS_LEVELS}u);k++){`,
    `bound=hizBound4(hizTile[i],hizTile[i+dx],hizTile[i+dy*${HIZ_BUILD_SIDE}u],hizTile[i+dy*${HIZ_BUILD_SIDE}u+dx],dx,dy);`,
    'hizPutBound(dst.x+ty*dst.y+tx,bound);',
    'return vec3f(min(a.x,b.x),max(a.y,b.y),min(a.z,b.z));',
  ])
    assert.ok(build.includes(line), line)
  // The finished depth's farthest layer is written where the planes are kept, and only there.
  assert.ok(
    HIZ_SHADER.includes(
      `if(hizKeepsPlanes()){hizPut(i,${HIZ_WHOLE_FARTHEST}u,bitcast<u32>(bound.z));}`,
    ),
  )
  assert.equal(
    build.match(/workgroupBarrier\(\);/g)?.length,
    3,
    'depth tile, barrier; read, barrier, write, barrier',
  )
  // The culling layer is the opaque depth alone: a transparent surface in front must never hide
  // what lies behind it from the occlusion test, the partition's cull or the transparent test.
  // The image's own build reads it as the image wrote it (`hizLevel0`), and writes no copy of it
  // into the pyramid: the opaque depth is read once (`hizOpaqueAt`, level 0's first layer here,
  // the visibility buffer in `workDepthSource.ts`) and is the cull's alone.
  assert.match(
    build,
    /let opaque=hizOpaqueAt\(q\);\s*hizStoreOpaque\(q,opaque\);\s*let cull=hizLevel0\(opaque\);/,
  )
  assert.match(
    HIZ_SHADER,
    /fn hizOpaqueAt\(q:vec2i\)->f32\{return textureLoad\(level0,q,0,0\)\.r;\}/,
  )
  assert.doesNotMatch(
    HIZ_SHADER,
    /hizPut\(i,\d+u,bitcast<u32>\(depth\)\)/,
    'no copy of the depth into the pyramid',
  )
  assert.match(HIZ_SHADER, /fn hizLevel0\(z:f32\)->f32\{return z;\}/)
  assert.equal(
    HIZ_SHADER.match(/hizFrontAt\(/g)?.length,
    2,
    'its definition and the depth tile of the planes: the first pass reads each depth once (hizFrontOf)',
  )
})

test("the first level gathers the image's last two texels at an odd edge, as the reference gather does", () => {
  // Three texels wide: the last cell holds texels 1 and 2, not texel 2 alone.
  const texture = Float32Array.from([0.9, 0.1, 0.5])
  const s: Scene = { texture, width: 3, height: 1, maxLevels: HIZ_MAX_LEVELS, trace: false }
  const { words, offsets } = layout(s)
  const layers = {
    cull: new Float32Array(words),
    nearest: new Float32Array(words),
    whole: new Float32Array(words),
  }
  buildBefore(s, layers)
  assert.deepEqual(
    [...layers.cull.subarray(offsets[1], offsets[1] + 2)],
    [Math.fround(0.1), Math.fround(0.1)],
  )
  const after = {
    cull: new Float32Array(words),
    nearest: new Float32Array(words),
    whole: new Float32Array(words),
  }
  buildAfter(s, after, lcgRandom(1))
  assert.deepEqual(
    [...after.cull.subarray(offsets[1], offsets[1] + 2)],
    [Math.fround(0.1), Math.fround(0.1)],
  )
})

test('the image build over the visibility buffer is the same kernel, its depth read there and written into level 0', () => {
  const last = 'hizPutBound(dst.x+ty*dst.y+tx,bound);'
  // From the tile's loader to the last write of the kernel: the text both builds share.
  const kernel = (code: string) =>
    code.slice(code.indexOf('fn hizLoadDepthTile'), code.lastIndexOf(last) + last.length)
  for (const wide of [true, false]) {
    const work = hizBuildShader(HIZ_IMAGE_LEVEL0, hizWorkSource(wide))
    assert.equal(kernel(work), kernel(HIZ_SHADER), `wide ${wide}: the kernel`)
    assert.ok(kernel(HIZ_SHADER).length > 1000)
    // The buffer's depth, the background past the viewport, and level 0 written with what was read.
    assert.match(work, /fn hizStoreOpaque\(q:vec2i,z:f32\)\{textureStore\(level0Out,q,/)
    assert.match(work, /p\.x>=u32\(uni\.viewport\.x\)\|\|p\.y>=u32\(uni\.viewport\.y\)/)
    assert.doesNotMatch(work, /textureLoad\(level0,/)
    // One read of the buffer's depth and one fold, shared with the export and the texture build.
    assert.equal(work.match(/fn depthAt\(/g)?.length, 1)
    assert.equal(work.match(/max\(opaque,/g)?.length, 1, 'the fold is hizFoldOf alone')
    // Level 0 past the drawn size is the background, written by the first pass.
    assert.match(
      work,
      /fn hizClearBeyond\(x:u32,y:u32\)\{\s*let size=textureDimensions\(level0Out\)/,
    )
    assert.equal(/work\[pixelOffset\(p\)\]\.y/.test(work), wide)
    assert.equal(/var hwDepth:texture_depth_2d/.test(work), !wide)
  }
  // The texture build reads level 0 and writes nothing there.
  assert.match(HIZ_SHADER, /fn hizStoreOpaque\(q:vec2i,z:f32\)\{\}/)
})
