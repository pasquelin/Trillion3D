/**
 * The names a WGSL text uses that it declares nowhere: what a device refuses to compile as an
 * unresolved value or an unresolved call. A small reader of the text, not a compiler: it takes
 * every declaration of the module (functions, structures, aliases, constants, variables and
 * parameters) as in scope everywhere, and WGSL's own words as always in scope, so it misses a
 * name used outside its function but never flags a name the text does declare. It checks names
 * only: a member a structure lacks, a wrong type or a name declared twice passes it.
 */

import { withoutComments } from '../../../../math/src/wgsl/comments.ts'

/** WGSL's own words: keywords, the phony assignment's `_`, types, address spaces, access modes,
 *  texel formats, built-in functions. The only names a shader uses without declaring them. */
const WGSL_OWN = new Set(
  (
    '_ alias array atomic bitcast bool break case const continue continuing default diagnostic ' +
    'discard else enable f16 f32 false fn for function i32 if let loop mat2x2f mat3x3f mat3x4f mat4x4f ' +
    'override private ptr read read_write return sampler sampler_comparison storage struct ' +
    'switch true u32 uniform var vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u ' +
    'vec4u while workgroup write ' +
    'texture_2d texture_2d_array texture_3d texture_cube texture_depth_2d texture_depth_2d_array ' +
    'texture_storage_2d texture_storage_2d_array texture_multisampled_2d ' +
    'r32float r32uint rg32float rg32uint rgba8unorm rgba16float rgba32float rgba32uint ' +
    'abs acos all any arrayLength asin atan atan2 atomicAdd atomicAnd atomicCompareExchangeWeak atomicExchange atomicLoad ' +
    'atomicMax atomicMin atomicOr atomicStore atomicSub ceil clamp cos countLeadingZeros countOneBits cross ' +
    'degrees determinant distance dot dpdx dpdy exp exp2 extractBits faceForward firstLeadingBit firstTrailingBit ' +
    'floor fma fract fwidth insertBits inverseSqrt ldexp length log log2 max min mix normalize ' +
    'pack2x16float pack2x16snorm pack2x16unorm pack4x8unorm pow quantizeToF16 reflect refract reverseBits round saturate select ' +
    'sign sin smoothstep sqrt step storageBarrier subgroupAny subgroupBallot subgroupBroadcastFirst ' +
    'subgroupElect subgroupMax subgroupMin tan tanh textureDimensions textureGather textureGatherCompare ' +
    'textureLoad textureNumLayers textureNumLevels textureSample textureSampleBias textureSampleCompare ' +
    'textureSampleCompareLevel textureSampleGrad textureSampleLevel textureStore transpose ' +
    'trunc unpack2x16float unpack2x16snorm unpack2x16unorm unpack4x8unorm workgroupBarrier workgroupUniformLoad'
  ).split(/\s+/),
)

/** Every name the module declares: its functions, structures, aliases, constants and variables,
 *  module-scope or local, and, once member names and case colons are gone, every name a type
 *  follows — a parameter or a typed declaration. */
function declaredNames(code: string) {
  const declares = /\b(?:fn|struct|alias|const|let|var(?:\s*<[^>]*>)?|override)\s+(\w+)|(\w+)\s*:/g
  return new Set([...code.matchAll(declares)].map((m) => m[1] ?? m[2]))
}

/** The names `source` uses and declares nowhere, sorted: comments, directives (`enable`,
 *  `requires`, `diagnostic`), attributes and structure member names left out (their types kept,
 *  and an attribute's argument unless it is a built-in's, an interpolation's or a diagnostic's word), a
 *  case selector never taken for a declaration, a member after a dot never taken for a name. */
export function unresolvedNames(source: string) {
  const code = withoutComments(source)
    .replace(/\b(?:enable|requires)\s[^;]*;|^diagnostic\s*\([^()]*\);/gm, '')
    .replace(/@(?:builtin|interpolate|diagnostic)\s*\([^()]*\)|@\w+/g, '')
    .replace(/(\bstruct\s+\w+\s*\{)([^}]*)\}/g, (_, head: string, body: string) => {
      return `${head}${body.replace(/\w+\s*:/g, ':')}}`
    })
    .replace(/\b(case\b[^:{]*|default\s*):/g, '$1')
  const declared = declaredNames(code)
  const used = new Set([...code.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map((m) => m[1]))
  return [...used].filter((name) => !declared.has(name) && !WGSL_OWN.has(name)).sort()
}

/** The names `source` declares at module scope, in its order, each as often as it is declared:
 *  functions, structures, aliases, constants, overrides and variables, outside every brace and
 *  comment. A name met twice is a module a device refuses, whatever the two texts. */
export function topLevelNames(source: string) {
  const code = withoutComments(source)
  let depth = 0
  let outside = ''
  for (const c of code) {
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0) outside += c
  }
  const declares = /\b(?:fn|struct|alias|const|override|var(?:\s*<[^>]*>)?)\s+(\w+)/g
  return [...outside.matchAll(declares)].map((m) => m[1])
}

/** The words WGSL reserves for later use, which no name may be: a device refuses a module that
 *  names one. */
const WGSL_RESERVED = new Set(
  (
    'abstract active alignas alignof as asm asm_fragment async attribute auto await become cast ' +
    'catch class co_await co_return co_yield coherent column_major common compile ' +
    'compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype ' +
    'delete demote demote_to_helper do dynamic_cast enum explicit export extends extern ' +
    'external fallthrough filter final finally friend from fxgroup get goto groupshared highp ' +
    'impl implements import inline instanceof interface layout lowp macro macro_rules match ' +
    'mediump meta mod module move mut mutable namespace new nil noexcept noinline ' +
    'nointerpolation non_coherent noncoherent noperspective null nullptr of operator package ' +
    'packoffset partition pass patch pixelfragment precise precision premerge priv protected ' +
    'pub public readonly ref regardless register reinterpret_cast require resource restrict ' +
    'self set shared sizeof smooth snorm static static_assert static_cast std subroutine super ' +
    'target template this thread_local throw trait try type typedef typeid typename typeof ' +
    'union unless unorm unsafe unsized use using varying virtual volatile wgsl where with ' +
    'writeonly yield'
  ).split(/\s+/),
)

/** The reserved words (`WGSL_RESERVED`) `source` takes as names, sorted: a device refuses the
 *  module (`'from' is a reserved keyword`). Comments, directives and the arguments of built-in,
 *  interpolation and diagnostic attributes are no names; a member after a dot is one. */
export function reservedNames(source: string) {
  const code = withoutComments(source)
    .replace(/\b(?:enable|requires)\s[^;]*;|^diagnostic\s*\([^()]*\);/gm, '')
    .replace(/@(?:builtin|interpolate|diagnostic)\s*\([^()]*\)/g, '')
  const names = new Set([...code.matchAll(/(?<!\w)([A-Za-z_]\w*)/g)].map((m) => m[1]))
  return [...names].filter((name) => WGSL_RESERVED.has(name)).sort()
}
