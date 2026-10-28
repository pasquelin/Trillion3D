import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'

/** Where the writer of the lighting's words binds what it reads and writes, in group 0. */
export const INDIRECT_WORDS_BINDINGS = {
  normals: 0,
  light: 1,
  rough: 2,
  open: 3,
  params: 4,
  words: 5,
} as const
const B = INDIRECT_WORDS_BINDINGS

/** The words' format (`SCREEN_PROBE_FORMATS.history`): four words a pixel, which the lighting reads (`SCREEN_INDIRECT_WGSL`). */
export const INDIRECT_WORDS_FORMAT = 'rgba32uint' as const

/** The flags of the writer's parameters (`x` the reduction of the sources, `y` these bits, `z` the factor the light is written under, the image's pre-exposure as float bits, `w` the reduction of the openness texture where it is not the light's, zero for the light's): the light's alpha says whether its texel answered; the openness is read from its own texture. */
export const INDIRECT_WORDS_FLAG = { alphaAnswers: 1, openTexture: 2 } as const

/** The layout of the writer's group 0; `bent` where the openness texture holds the bent normal's word (`spBentPack`), else an amount. */
export const indirectWordsEntries = (bent: boolean) => [
  computeTextureEntry(B.normals, 'float'),
  computeTextureEntry(B.light, 'unfilterable-float'),
  computeTextureEntry(B.rough, 'unfilterable-float'),
  computeTextureEntry(B.open, bent ? 'uint' : 'unfilterable-float'),
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.words, INDIRECT_WORDS_FORMAT),
]

/**
 * THE ONE WRITER OF THE WORDS THE LIGHTING READS OF THE PIXELS' INDIRECT LIGHT (`SCREEN_INDIRECT_WGSL`), whatever gathered it — the irradiance field, the screen's own
 * indirect light —: a thread a pixel of the image reads the four texels of the sources (a texel every `reduction` pixels, the texel t standing at the pixel t times the reduction) that lie round it, each weighed by its place bilinearly, by how much
 * its normal agrees with the pixel's (to the eighth power, a thousandth at least) and by whether it answered, and writes the words: the mean radiance `light` times pi as the irradiance (`x`), the rough
 * specular's radiance (`y`), none for the back of a thin sheet (`z`), and the bent normal (`w`) — the pixel's normal times the openness, which is one where the source knows none, so the lighting
 * applies no occlusion. Where the openness texture holds the bent normal's word (`bent`, the field's occlusion with the bent normal), the pixel's own texel is the word written as it is. A pixel that is no surface, or that no texel answered, has zero words: the probes left nothing there.
 */
export const indirectWordsProgram = (bent: boolean) =>
  wgslProgram(
    `@group(0) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${B.light}) var light:texture_2d<f32>;
@group(0) @binding(${B.rough}) var rough:texture_2d<f32>;
@group(0) @binding(${B.open}) var open:texture_2d<${bent ? 'u32' : 'f32'}>;
@group(0) @binding(${B.params}) var<uniform> source:vec4u;
@group(0) @binding(${B.words}) var wordsOut:texture_storage_2d<${INDIRECT_WORDS_FORMAT},write>;
@compute @workgroup_size(8,8)
fn indirectWords(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(surfaceNormals);
 if(any(id.xy>=size)){return;}
 let at=vec2i(id.xy);
 let n=textureLoad(surfaceNormals,at,0).xyz;
 if(dot(n,n)<0.5){textureStore(wordsOut,at,vec4u(0u));return;}
 let N=normalize(n);
 let reduction=f32(source.x);
 let held=vec2i(textureDimensions(light));
 let q=vec2f(id.xy)/reduction;
 let base=vec2i(floor(q));
 let f=fract(q);
 var irradiance=vec3f(0.0);
 var specular=vec3f(0.0);
 var openness=0.0;
 var total=0.0;
 for(var i=0u;i<4u;i++){
  let offset=vec2i(i32(i&1u),i32(i>>1u));
  let tap=clamp(base+offset,vec2i(0),held-vec2i(1));
  let seen=textureLoad(light,tap,0);
  let tapNormal=textureLoad(surfaceNormals,min(vec2i(vec2f(tap)*reduction),vec2i(size)-vec2i(1)),0).xyz;
  let lit=dot(tapNormal,tapNormal)>0.5;
  let answered=select(lit,seen.a>0.5,(source.y&${INDIRECT_WORDS_FLAG.alphaAnswers}u)!=0u);
  let bilinear=select(1.0-f.x,f.x,offset.x==1)*select(1.0-f.y,f.y,offset.y==1);
  let weight=select(0.0,bilinear*(pow(saturate(dot(N,normalize(tapNormal))),8.0)+0.001),answered);
  irradiance+=max(makeFinite3(seen.rgb),vec3f(0.0))*weight;
  specular+=max(makeFinite3(textureLoad(rough,tap,0).rgb),vec3f(0.0))*weight;
  // The openness is the light's texel's, or, where the source names a reduction of its own (source.w), the pixel's own texel of a texture cut at it.
  let opened=select(tap,min(vec2i(id.xy/vec2u(max(source.w,1u))),vec2i(textureDimensions(open))-vec2i(1)),source.w>0u);
  openness+=${bent ? '1.0' : `select(1.0,saturate(textureLoad(open,opened,0).r),(source.y&${INDIRECT_WORDS_FLAG.openTexture}u)!=0u)`}*weight;
  total+=weight;
 }
 if(total<=1e-6){textureStore(wordsOut,at,vec4u(0u));return;}
 let inverse=1.0/total;
${bent ? ' let word=textureLoad(open,min(id.xy/vec2u(max(source.w,1u)),textureDimensions(open)-vec2u(1)),0).r;\n let bent=select(spBentPack(N),word,word!=0u);' : ' let bent=spBentPack(N*max(openness*inverse,1.0/255.0));'}
 textureStore(wordsOut,at,vec4u(packLight(irradiance*inverse*PI*bitcast<f32>(source.z)),packLight(specular*inverse*bitcast<f32>(source.z)),0u,bent));
}`,
    [packLight, makeFinite3, PI, SP_BENT_WGSL],
  )
