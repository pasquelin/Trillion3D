// A module with a name it declares nowhere compiles on no device: the recette's browser would
// be the first to see it (#348, `unresolved value 'uni'` in the cluster decoding proof, which
// decodes through the page geometry and declares no camera). This Node test reads every text the
// engine compiles, and those of the proofs that compile their own, before any browser does: the
// cut-dispatches oracle's too (#364, `unresolved call target 'spriteOf'`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { ENGINE_SHADERS } from './engineShaders.fixture.ts'
import { reservedNames, unresolvedNames } from './wgslNames.fixture.ts'
import { PAGE_GEOMETRY_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_BINDING, PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { VIS_SHADER } from '../../visibility/buffer.ts'
import { CLUSTER_DECODING_SHADER } from '../../../../../tests/gpu/cluster/decodingKernel.ts'
import { DAG_SELECTION_SHADER_BEFORE } from '../../../../../bench/oracles/browser/cut-dispatches-wgsl.ts'

test('every WGSL text the engine and its proofs compile declares every name it uses', () => {
  const shaders = { ...ENGINE_SHADERS, CLUSTER_DECODING_SHADER, DAG_SELECTION_SHADER_BEFORE }
  const unresolved = Object.entries(shaders)
    .map(([name, code]) => [name, unresolvedNames(code)] as const)
    .filter(([, names]) => names.length)
  assert.deepEqual(Object.fromEntries(unresolved), {})
  // Nor a name WGSL reserves (`'from' is a reserved keyword`, the blend program on the panes'
  // page, once a march's local was so named).
  const reserved = Object.entries(shaders)
    .map(([name, code]) => [name, reservedNames(code)] as const)
    .filter(([, names]) => names.length)
  assert.deepEqual(Object.fromEntries(reserved), {})
})

test('a reserved word is found as a local, a parameter or a member, never in a comment', () => {
  assert.deepEqual(reservedNames('fn f(pass:u32)->u32{var from=pass;return s.target+from;}'), [
    'from',
    'pass',
    'target',
  ])
  assert.deepEqual(reservedNames('// from the target\n@builtin(position) p:vec4f'), [])
  // The translucent march's walk, as it was named before this gate.
  const blend = ENGINE_SHADERS.BLEND_SHADER
  assert.deepEqual(reservedNames(blend), [])
  assert.deepEqual(reservedNames(blend.replace(/\bwalkFrom\b/g, 'from')), ['from'])
})

/** The call sites that compile a text their caller hands them (the resolve's, the deferred
 *  program's): the texts those callers pass are on the list under their own names. The virtual
 *  shadow map passes compile what their generators build for the session's layout: each
 *  generator's text is on the list for one layout, and every generator they import must be. */
const HANDED_IN = new Set([
  'gpu/core/shaderModule.ts',
  'webgpu/shadow/computePass.ts',
  'gpu/raster/resolve.ts',
  'lighting/deferred/program.ts',
  'lighting/deferred/compositions.ts',
  'vsm/invalidationPass.ts',
  'vsm/markingPass.ts',
  'vsm/passKit.ts',
  'vsm/pageManagementPass.ts',
  'vsm/projectionPass.ts',
  'vsm/renderPass.ts',
  'vsm/transmissionPass.ts',
])

test('the list holds the text of every call that compiles a module', () => {
  // A pass added without its text on the list would escape the sweep above without a word.
  const fixture = [
    'engineShaders.fixture.ts',
    'engineShaders.vsm.fixture.ts',
    'engineShaders.reflections.fixture.ts',
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
      // The blend module appends checked feedback-free entries to listed source texts.
      if (file === 'webgpu/blend/pipelines.ts' && plain?.trim() === 'code') {
        assert.match(text, /let code\s*=\s*blendShader\(/)
        assert.match(text, /code = feedbackFreeEntry\(/)
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
  assert.deepEqual(unresolvedNames(PAGE_INFO_STRUCT_WGSL + PAGE_GEOMETRY_WGSL), [
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
  const F32_MAX = 3.4028234663852886e38
  const literal = /(?<![\w.])(\d+\.\d*(?:e[+-]?\d+)?|\d+e[+-]?\d+)f?(?![\w.])/gi
  const past: string[] = []
  for (const [name, code] of Object.entries(ENGINE_SHADERS))
    for (const [, text] of code.matchAll(literal))
      if (Math.abs(Number(text)) > F32_MAX) past.push(`${name}: ${text}`)
  assert.deepEqual(past, [])
})
