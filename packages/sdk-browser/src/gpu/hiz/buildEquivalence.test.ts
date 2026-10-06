import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_SHADER } from './shader.ts'
import { HIZ_BUILD_SIDE as S, HIZ_MAX_LEVELS, HIZ_PASS_LEVELS, hizBuildPasses } from './uniforms.ts'
import { buildAfter, buildBefore, layout, lcg, type Scene } from './buildTranscripts.fixture.ts'
import { hizLevelSizes } from './levelSizes.ts'

// The reference pyramid build is a copy of the level-0 texture then one dispatch per mip, each
// reading the level above from the buffer. `buildHiz` reads the texture once, copies it on the
// way and reduces four mips per dispatch through workgroup memory. Below, both transcribed line by
// line,
// driven by the uniform words the host really writes, must leave the pyramid buffer identical
// bit for bit — every texel written, no other — on random sizes, capped mip counts, several
// pyramids per dispatch, and NaN, ±0, ±Inf depths.

const SPECIALS = [0, -0, 1, Infinity, -Infinity, Number.NaN]

function scene(rand: () => number, hostile: boolean): Scene {
  const pick = (n: number) => 1 + Math.floor(rand() * n)
  const width = rand() < 0.2 ? pick(3) : pick(140),
    height = rand() < 0.2 ? pick(3) : pick(140)
  const pages = rand() < 0.3 ? pick(3) : 0
  const textureWidth = width + (pages ? pick(20) : 0),
    textureHeight = height + (pages ? pick(20) : 0)
  const texture = Float32Array.from({ length: textureWidth * textureHeight }, () =>
    hostile && rand() < 0.05 ? SPECIALS[Math.floor(rand() * SPECIALS.length)] : rand(),
  )
  const origins = pages
    ? Array.from(
        { length: pages },
        () =>
          [
            Math.floor(rand() * (textureWidth - width + 1)),
            Math.floor(rand() * (textureHeight - height + 1)),
          ] as [number, number],
      )
    : undefined
  const maxLevels = rand() < 0.2 ? pick(6) : HIZ_MAX_LEVELS
  return { texture, textureWidth, width, height, maxLevels, origins }
}

function assertSamePyramid(s: Scene, rand: () => number, label: string) {
  const { words } = layout(s)
  // The same garbage on both sides: a texel one side writes and the other does not shows.
  const before = Float32Array.from({ length: words + 8 }, (_, i) => -1000 - i)
  const after = Float32Array.from(before)
  buildBefore(s, before)
  buildAfter(s, after, rand)
  assert.deepEqual(new Uint32Array(after.buffer), new Uint32Array(before.buffer), label)
}

for (const [seed, hostile, trials] of [
  [5, false, 300],
  [17, true, 150],
] as const)
  test(`same pyramid, bit for bit, seed ${seed}${hostile ? ', with NaN, ±0 and ±Inf depths' : ''}`, () => {
    const rand = lcg(seed)
    for (let trial = 0; trial < trials; trial++)
      assertSamePyramid(scene(rand, hostile), rand, `trial ${trial}`)
  })

test('edge sizes: one texel, one row, one column, a tile edge, 1080p, a capped mip count', () => {
  const rand = lcg(3)
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
  for (const [width, height, maxLevels] of sizes) {
    const texture = Float32Array.from({ length: width * height }, () => rand())
    assertSamePyramid(
      { texture, textureWidth: width, width, height, maxLevels },
      rand,
      `${width}×${height}`,
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

test('the shipped build is one kernel over workgroup memory, with no copy kernel left', () => {
  assert.match(HIZ_SHADER, new RegExp(`var<workgroup> hizTile:array<f32,${S * S}>;`))
  assert.match(HIZ_SHADER, new RegExp(`@workgroup_size\\(${S}, ${S}\\)\\s*fn buildHiz\\(`))
  assert.match(HIZ_SHADER, new RegExp(`dst:array<vec4u,${HIZ_PASS_LEVELS}>,`))
  assert.doesNotMatch(HIZ_SHADER, /fn copyDepth|fn reduceHiz/)
  // The lines the transcript follows, pinned: a slip in the WGSL alone shows here.
  const build = HIZ_SHADER.slice(
    HIZ_SHADER.indexOf('fn hizSource'),
    HIZ_SHADER.indexOf('fn texelsHide'),
  )
  for (const line of [
    'if(uni.a!=0u){return pyramid[i];}',
    'if(uni.d>0u){pyramid[uni.dst[0].x+z*uni.g+y*uni.dst[0].y+x]=far;}',
    `for(var k=1u;k<min(uni.d,${HIZ_PASS_LEVELS}u);k++){`,
    `far=hizFar4(hizTile[i],hizTile[i+dx],hizTile[i+dy*${S}u],hizTile[i+dy*${S}u+dx],dx,dy);`,
    'pyramid[dst.x+z*uni.g+ty*dst.y+tx]=far;',
  ])
    assert.ok(build.includes(line), line)
  assert.equal(build.match(/workgroupBarrier\(\);/g)?.length, 2, 'read, barrier, write, barrier')
})
