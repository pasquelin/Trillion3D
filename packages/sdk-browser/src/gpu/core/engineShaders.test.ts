// A module with a name it declares nowhere compiles on no device: a browser would be the
// first to see it (`unresolved value 'uni'` in the cluster decoding proof, which
// decodes through the page geometry and declares no camera). This Node test reads every text the
// engine compiles, and those of the proofs that compile their own, before any browser does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { ENGINE_SHADERS } from './engineShaders.fixture.ts'
import { reservedNames, topLevelNames, unbalanced, unresolvedNames } from './wgslNames.fixture.ts'
import { PAGE_GEOMETRY_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_BINDING, PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { VIS_SHADER } from '../../visibility/shader/visWgsl.ts'
import { CLUSTER_DECODING_SHADER } from '../../../../../tests/gpu/cluster/decodingKernel.ts'
import { FLOAT32_MAX } from '../../../../math/src/constants.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { dofTemporalShader } from '../../post/effects/depthOfField/dofTemporalWgsl.ts'

test('every WGSL text the engine and its proofs compile declares every name it uses', () => {
  const shaders = { ...ENGINE_SHADERS, CLUSTER_DECODING_SHADER }
  const unresolved = Object.entries(shaders)
    .map(([name, code]) => [name, unresolvedNames(code)] as const)
    .filter(([, names]) => names.length)
  assert.deepEqual(Object.fromEntries(unresolved), {})
  // Nor a name WGSL reserves (`'from' is a reserved keyword`, as a march's local named so
  // would be).
  const reserved = Object.entries(shaders)
    .map(([name, code]) => [name, reservedNames(code)] as const)
    .filter(([, names]) => names.length)
  assert.deepEqual(Object.fromEntries(reserved), {})
})

test('every WGSL text the engine and its proofs compile pairs its braces and parentheses', () => {
  // A brace left from an edit closes nothing: the device refuses the whole module.
  const shaders = { ...ENGINE_SHADERS, CLUSTER_DECODING_SHADER }
  const broken = Object.entries(shaders)
    .map(([name, code]) => [name, unbalanced(code)] as const)
    .filter(([, where]) => where)
  assert.deepEqual(Object.fromEntries(broken), {})
  assert.equal(unbalanced('fn f(){} // }\n/* ( */'), '')
  assert.equal(unbalanced('fn f(){}\n}'), "'}' at 9")
  assert.equal(unbalanced('fn f({}'), "'(' open")
})

test('no WGSL text the engine and its proofs compile declares a name twice', () => {
  // A fragment spliced into two others, or a declaration written by a fragment and by its host,
  // is a module a device refuses even when both texts are equal: each fragment is a declaration
  // its hosts list, and the assembler writes it once.
  const shaders = { ...ENGINE_SHADERS, CLUSTER_DECODING_SHADER }
  const twice: string[] = []
  for (const [name, code] of Object.entries(shaders)) {
    const seen = new Set<string>()
    for (const declared of topLevelNames(code)) {
      if (seen.has(declared)) twice.push(`${name}: ${declared}`)
      seen.add(declared)
    }
  }
  assert.deepEqual(twice, [])
})

test('a module-scope name is read outside braces and comments, every declaration of it counted', () => {
  const code = `struct S{x:f32,} // fn gone()
const K=1.0; override N:u32=4u; alias A=vec3f; var<private> p:f32; @group(0) @binding(0) var t:texture_2d<f32>;
fn f(a:f32)->f32{const local=2.0;var v=a;return v*local;}
fn f(a:f32)->f32{return a;}`
  assert.deepEqual(topLevelNames(code), ['S', 'K', 'N', 'A', 'p', 't', 'f', 'f'])
})

test('a reserved word is found as a local, a parameter or a member, never in a comment', () => {
  assert.deepEqual(reservedNames('fn f(pass:u32)->u32{var from=pass;return s.target+from;}'), [
    'from',
    'pass',
    'target',
  ])
  assert.deepEqual(reservedNames('// from the target\n@builtin(position) p:vec4f'), [])
  const blend = ENGINE_SHADERS.BLEND_SHADER
  assert.deepEqual(reservedNames(blend), [])
  assert.deepEqual(reservedNames(blend.replace(/\bclamped\b/g, 'from')), ['from'])
  assert.deepEqual(reservedNames('struct S{diagnostic:f32,}'), ['diagnostic'])
})

/** The call sites that compile a text their caller hands them (the resolve's, the deferred
 *  program's): the texts those callers pass are on the list under their own names. The virtual
 *  shadow map passes compile what their generators build for the session's layout: each
 *  generator's text is on the list for one layout, and every generator they import must be. */
const HANDED_IN = new Set([
  'gpu/core/shaderModule.ts',
  'gpu/sort/sortKit.ts',
  'gpu/core/computeStages.ts',
  'modules/sky/clouds/generation.ts',
  'modules/sky/clouds/viewPrograms.ts',
  'modules/sky/skyLight/pipelines.ts',
  'visibility/raster/resolve.ts',
  'materials/texture/coverageMips.ts',
  'lighting/deferred/program.ts',
  'lighting/deferred/compositions.ts',
  'lighting/bounce/cache/cacheKernels.ts',
  'lighting/bounce/screen/kernels.ts',
  'lighting/ao/pipelines.ts',
  'lighting/atmosphere/opaqueHaze.ts',
  'lighting/atmosphere/resources.ts',
  'lighting/shadows/vsm/invalidation/castStale.ts',
  'lighting/shadows/vsm/chunks/chunkKernels.ts',
  'lighting/shadows/vsm/markingPass.ts',
  'lighting/shadows/vsm/passKit.ts',
  'lighting/shadows/vsm/pageManagementPass.ts',
  'lighting/shadows/vsm/projection/projectionPipelines.ts',
  'lighting/shadows/vsm/render/renderPipes.ts',
  'lighting/shadows/vsm/tessellation/shadowPrograms.ts',
  'lighting/shadows/vsm/transmission/transmissionContext.ts',
  'lighting/shadows/vsm/transmission/transmissionPipes.ts',
])

test('the list holds the text of every call that compiles a module', () => {
  // A pass added without its text on the list would escape the sweep above without a word.
  const fixture = [
    'engineShaders.fixture.ts',
    'engineShaders.vsm.fixture.ts',
    'engineShaders.compose.fixture.ts',
    'engineShaders.post.fixture.ts',
    'engineShaders.blur.fixture.ts',
  ]
    .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
    .join('\n')
  const listed = new Set(
    [...fixture.matchAll(/import\s*\{([^}]*)\}/g)].flatMap((m) => m[1].match(/\w+/g)),
  )
  const source = new URL('../../', import.meta.url)
  const unlisted: string[] = []
  for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file)) continue
    const text = readFileSync(new URL(file, source), 'utf8')
    if (HANDED_IN.has(file)) {
      // Its texts come from generators: each one it imports from a WGSL module is on the list.
      const generators = [
        ...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*Wgsl\.ts'/g),
      ].flatMap((m) => m[1].match(/\w+(?:Wgsl|_WGSL|Kernels)\b/g) ?? [])
      for (const name of generators) if (!listed.has(name)) unlisted.push(`${file}: ${name}`)
      continue
    }
    const calls =
      /createCheckedShaderModule\(\s*\w+,\s*([^,]+),|createShaderModule\(\{[^}]*?\bcode:([^}]*)\}/g
    const read = [...text.matchAll(calls)]
    // A call in a form the pattern does not read is reported, never skipped.
    if (read.length !== text.split(/create(?:Checked)?ShaderModule\(/).length - 1)
      unlisted.push(`${file}: a call not read`)
    for (const [, checked, plain] of read) {
      // The blend module's text is built by its own helper (`blendModuleCode`) from listed texts.
      const helper = /^blendModuleCode\(/.test(plain?.trim() ?? '')
      if (file === 'blend/pipelines.ts' && helper) {
        assert.match(text, /return blendShader\(/)
        continue
      }
      const names = (checked ?? plain).match(/\b[A-Za-z_]\w*\b/g) ?? []
      const known = names.filter((name) => listed.has(name))
      const constants = names.filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name))
      if (!known.length || constants.some((name) => !known.includes(name)))
        unlisted.push(`${file}: ${names}`)
    }
  }
  assert.deepEqual(unlisted, [])
})

test('the page geometry reads its buffers alone, never the camera uniform', () => {
  assert.deepEqual(unresolvedNames(wgslModule(PAGE_INFO_STRUCT_WGSL, PAGE_GEOMETRY_WGSL)), [
    'indices',
    'positions',
    'uvs',
  ])
})

test('a camera pass without its camera uniform leaves `uni` unresolved', () => {
  assert.ok(VIS_SHADER.includes(PAGE_BINDING.uniforms))
  assert.deepEqual(unresolvedNames(VIS_SHADER.replace(PAGE_BINDING.uniforms, '')), ['uni'])
})

test('a comment, an attribute, a structure member or a field after a dot is never a name', () => {
  const code = `struct S{uni:f32,}
/** uni.viewport */ // uni
@group(0) @binding(0) var<uniform> s:S;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){let v=s.uni+f32(id.x);}`
  assert.deepEqual(unresolvedNames(code), [])
  assert.deepEqual(unresolvedNames(code.replace('var<uniform> s:S', 'var<uniform> t:S')), ['s'])
})

test('a member type, a case selector, a size attribute and code after a comment are still read', () => {
  assert.deepEqual(unresolvedNames('struct A{x:Gone,} var<private> a:A;'), ['Gone'])
  assert.deepEqual(unresolvedNames('@compute @workgroup_size(SIZE) fn main(){}'), ['SIZE'])
  const choice = 'fn f(v:u32)->u32{switch v {case Gone:{return 1u;} default:{return 0u;}}}'
  assert.deepEqual(unresolvedNames(choice), ['Gone'])
  assert.deepEqual(unresolvedNames('// a/*b\nfn f()->u32{return gone;}\n/* c */'), ['gone'])
})

test('every float literal of the engine WGSL is a finite f32: a compiler refuses one past its greatest value', () => {
  // WGSL keeps a decimal literal only when it lies within f32's finite range: 3.40282347e38 is
  // past 3.4028234663852886e38 and makes the device refuse the whole module.
  const literal = /(?<![\w.])(\d+\.\d*(?:e[+-]?\d+)?|\d+e[+-]?\d+)f?(?![\w.])/gi
  const past: string[] = []
  for (const [name, code] of Object.entries(ENGINE_SHADERS))
    for (const [, text] of code.matchAll(literal))
      if (Math.abs(Number(text)) > FLOAT32_MAX) past.push(`${name}: ${text}`)
  assert.deepEqual(past, [])
})

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
