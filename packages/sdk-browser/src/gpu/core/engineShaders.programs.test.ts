// The behaviour of the programs beyond the names their texts declare: the depth of field's temporal
// accumulation run in JavaScript on its shipped text, and what a graph compiles to for the passes that read it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { topLevelNames } from './wgslNames.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { dofTemporalShader } from '../../post/effects/depthOfField/dofTemporalWgsl.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { compileGraph, type CompileOptions } from '../../materials/graph/compile.ts'
import { COLOR_SAMPLE_WGSL } from '../../materials/virtual/wgsl.ts'
import { TILE_REQUEST_WGSL } from '../../materials/virtual/requestWgsl.ts'

/** One pixel of the depth of field's temporal accumulation of its setup, run in JavaScript on the shipped
 *  text: the setup's samples `image` by place, a history `past` (written for a display of `rect`), its circle
 *  and the places it was sampled at, the motion `back`; an image 16 wide on a display of 16 (`up` 1), or 8. */
function accumulated(o: {
  image?: (x: number) => number
  past?: number
  coc?: [number, number]
  cut?: boolean
  back?: number[]
  high?: boolean
  up?: number
  rect?: number
  jitter?: number
  taps?: number[][]
}) {
  const out: Record<string, number[]> = {}
  const grey = (v: number) => [v, v, v, 1]
  const side = 16 / (o.up ?? 1)
  const view = {
    gather: [side / 2, side / 2, side / 2, side / 2],
    image: [side, side, side, side],
    pre: [8, 8, 8, 8],
    display: [16, 16, o.rect ?? 16, o.rect ?? 16],
    depthMap: [1, 1, side - 1, side - 1],
    scatter: [3, 10, 0, 1],
    temporal: [o.jitter ?? 0, 0, o.cut ? 1 : 0, 0],
    current: [0.04, 0, 0, 0],
    counts: [0, 0, 0, 0],
  }
  const { temporalSetup, encodeVector } = shaderRun<{
    temporalSetup: (id: number[]) => void
    encodeVector: (v: number[]) => number
  }>(dofTemporalShader(), ['temporalSetup', 'encodeVector'], {
    view,
    HIGH: o.high ?? true,
    DIVISOR: 2,
    colorOut: 'color',
    cocOut: 'coc',
    historySampler: {},
    currentColor: { load: (p: number[]) => grey((o.image ?? (() => 0.5))(p[0])) },
    currentCoc: { load: () => [o.coc?.[0] ?? 0, 0, 0, 0] },
    depthTexture: { load: () => 0.5 },
    vectors: { load: () => [encodeVector(o.back ?? [0, 0]), 0, 0, 0] },
    historyColor: { sample: (uv: number[]) => (o.taps?.push(uv), grey(o.past ?? 0.5)) },
    historyCoc: { sample: () => [o.coc?.[1] ?? 0, 0, 0, 0] },
    textureLoad: (t: { load: (p: number[]) => unknown }, p: number[]) => t.load(p),
    textureSampleLevel: (t: { sample: (uv: number[]) => number[] }, _s: unknown, uv: number[]) =>
      t.sample(uv),
    textureStore: (t: string, _p: number[], v: number[]) => void (out[t] = v),
  })
  temporalSetup([3, 3, 0])
  return out
}

const near = (a: number, b: number, why = '') => assert.ok(Math.abs(a - b) < 1e-3, `${why}: ${a}`)

test('the depth of field’s accumulation of its setup takes the image at a cut, holds the history to the neighbourhood, and blends at its weight', () => {
  const edge = (x: number) => (x <= 2 ? 0 : x >= 4 ? 1 : 0.5) // a step across the pixel: the box is [0, 1]
  for (const high of [true, false]) {
    near(accumulated({ cut: true, past: 9, high }).color[0], 0.5, 'a cut: the image alone')
    const inside = accumulated({ image: edge, past: 0.9, high }).color[0]
    near(inside, 0.88, 'inside the box: the history, 4 % image')
    near(
      accumulated({ image: edge, past: 5, high }).color[0],
      0.9737,
      'far outside: held to the box',
    )
    near(accumulated({ past: 0.5, high }).color[0], 0.5, 'a static pixel stays')
    assert.ok(
      accumulated({ image: edge, past: 0.9, back: [0.2, 0], high }).color[0] < inside,
      'moving',
    )
  }
  near(
    accumulated({ coc: [4, 9] }).coc[0],
    4,
    'the history’s circle is held to the neighbourhood’s',
  )
})

test('the accumulation filters the setup by the window of its jittered place, as wide as the pixel is large, and reads the history in the rectangle it was written in', () => {
  // The display's pixel 3 falls at 1.75 of a setup 4 texels wide (an image of 8 rebuilt to 16): the texel 1,
  // the pixel 0.25 from its centre; a jitter of 1 render pixel moves it by half a texel. A cut ignores the
  // history: the window is the wider (the image's share of the display) where it is none.
  const step = (x: number) => (x < 1 ? 0 : x === 1 ? 0.5 : 1)
  const window = (d2: number, scale2: number) => {
    const x2 = Math.min(1, scale2 * d2)
    return (0.905 * x2 - 1.9) * x2 + 1
  }
  const filtered = (offset: number[], at: number) => {
    const dx = [0, -1, 0, 1, 0]
    const dy = [-1, 0, 0, 0, 1]
    const w = dx.map((x, i) => window((x - offset[0]) ** 2 + (dy[i] - offset[1]) ** 2, 1))
    return dx.reduce((sum, x, i) => sum + w[i] * step(at + x), 0) / w.reduce((sum, v) => sum + v)
  }
  const cut = (jitter: number) => accumulated({ cut: true, image: step, up: 2, jitter }).color[0]
  near(cut(0), filtered([0.25, 0.25], 1))
  near(cut(1), filtered([-0.25, 0.25], 2)) // place 2.25: the texel 2, offset -0.25
  // A history written for a display of 8 lies in the first half of its images: every tap stays inside it.
  const taps: number[][] = []
  accumulated({ up: 2, rect: 8, taps })
  assert.ok(taps.length > 0 && taps.every(([u, v]) => u <= 0.4375 && v <= 0.4375), `${taps}`)
})

/** A graph that reads a texture at a tiled coordinate, and a time-driven emission. */
function tiledGraph() {
  const g = material.graph('surface')
  g.output(
    'baseColor',
    g.channel(g.textureSample(new Texture(), { uv: g.texCoord(1, 4, 4) }), 'rgb'),
  )
  g.output('emissive', g.sine(g.time(), 2))
  return g
}
const compileFor = (g: ReturnType<typeof tiledGraph>, options: Partial<CompileOptions> = {}) =>
  compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours', ...options })

test('a graph read by a pass with no derivative finds its footprints at the pixels beside', () => {
  const g = tiledGraph()
  const text = compileFor(g).wgsl.text
  // The coordinate is evaluated again a pixel to the right and a pixel below, tiling and all: the
  // difference is the derivative the hardware takes of the tiled coordinate.
  assert.match(text, /mgNeighbour\[0\]\.uvs\[1\] \* vec2f\(4\./)
  assert.match(text, /colorSample\(g\.t\[0\]\.x,v0,\(v1-v0\),\(v2-v0\),true\)/)
  assert.doesNotMatch(text, /dpdx/)
  // A fragment program has them: the same graph reads the screen's.
  assert.match(compileFor(g, { derivatives: 'screen' }).wgsl.text, /dpdx\(v0\),dpdy\(v0\)/)
  assert.deepEqual(
    [compileFor(g).uses.sets, compileFor(g).uses.textures, compileFor(g).uses.time],
    [0b10, true, true],
    'the texture sets it reads, as a mask',
  )
})

test('a graph asks the tile of each texture it reads, the very texel it reads', () => {
  const g = tiledGraph()
  const compiled = compileFor(g, { request: TILE_REQUEST_WGSL })
  assert.equal(compiled.reads, 1)
  assert.equal(compiled.ask, 'mgAsk')
  assert.match(
    compiled.wgsl.text,
    /fn mgAsk\(ctx:MgContext,g:MgValues,p:RequestPick,missing:bool\)->u32\{\n if\(p\.sel==0u\)\{[^]*return colorRequestIndex\(g\.t\[0\]\.x,v0,\(v1-v0\),\(v2-v0\),p\.next,p\.along,true,true,missing\);/,
  )
  assert.equal(compileFor(g).ask, undefined, 'a pass that asks nothing is given nothing')
})

test('the declarations of two graphs of one program are named apart by their suffix', () => {
  const first = compileFor(tiledGraph(), { suffix: '0' }),
    second = compileFor(tiledGraph(), { suffix: '1' })
  const code = wgslModule(first.wgsl, second.wgsl)
  const names = topLevelNames(code).filter((name) => /^[Mm]g/.test(name))
  assert.deepEqual(names.sort(), [
    ...['MgContext', 'MgValues0', 'MgValues1', 'mgBaseColor0', 'mgBaseColor1'],
    ...['mgEmissive0', 'mgEmissive1', 'mgNeighbour', 'mgSampleLevel'],
  ])
  assert.equal(second.functions.baseColor, 'mgBaseColor1')
  assert.equal(second.values, 'MgValues1')
})

test('a read whose coordinate is read from another takes that one’s footprint at the centre: three reads a level, not three to the power of it', () => {
  // The footprint of a read is its coordinate at the pixel beside, which reads the inner read there
  // once: the quad's one derivative gives the inner read its own, as the hardware's does.
  const reads = (depth: number) => {
    const g = material.graph('surface')
    let uv = g.texCoord(0)
    for (let level = 1; level < depth; level++)
      uv = g.componentMask(g.textureSample(new Texture(), { uv }), 'rg')
    g.output('baseColor', g.channel(g.textureSample(new Texture(), { uv }), 'rgb'))
    return compileFor(g).wgsl.text.match(/colorSample\(/g)?.length
  }
  assert.deepEqual([1, 2, 3, 4, 5].map(reads), [1, 4, 7, 10, 13])
})

test('a program is known by the whole text it compiles to, named by a hash of sixty-four bits found from the one compile', () => {
  const plain = compileFor(tiledGraph()),
    named = compileFor(tiledGraph(), { named: true })
  assert.match(plain.hash, /^[0-9a-z]{14}$/)
  assert.equal(
    named.hash,
    plain.hash,
    'the suffix is made of the hash, the hash is not of the suffix',
  )
  assert.equal(named.suffix, `_${plain.hash}`)
  assert.equal(plain.suffix, '')
  assert.ok(plain.key.startsWith('fn mgBaseColor(ctx:MgContext,g:MgValues)'), 'the key is the text')
  const other = material.graph('surface')
  other.output('baseColor', other.constant(1, 0, 0))
  assert.notEqual(compileFor(other).key, plain.key)
  assert.notEqual(compileFor(other).hash, plain.hash)
})

test('a cosine and a sine of a period that is zero or less read the raw angle, a period above 0 turns', () => {
  // The reference multiplies the angle of its cosine, for a period that is not above 0, by an
  // integer 0 its compiler takes for the index of the material's first value: a product with
  // whatever that is, never the angle. Ours reads the angle, as its sine does.
  const body = (kind: 'sine' | 'cosine', period: number) => {
    const g = material.graph('surface')
    g.output('roughness', g[kind](g.scalarParameter('x', 1), period))
    return compileFor(g).wgsl.text
  }
  for (const period of [0, -1, -0.5]) {
    assert.match(body('cosine', period), /let v0:f32=cos\(g\.v\[0\]\.x\);/)
    assert.match(body('sine', period), /let v0:f32=sin\(g\.v\[0\]\.x\);/)
  }
  assert.match(body('cosine', 2), /\(g\.v\[0\]\.x \* 3\.14159274\);\n let v1:f32=cos\(v0\)/)
})
