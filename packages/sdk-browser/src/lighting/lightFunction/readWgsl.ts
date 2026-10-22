import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATLAS_NUMBERS_AT, ENTRY_VEC4S, KINDS, LIGHT_FUNCTION_SHIFT } from './layout.ts'

/** Where a program binds what the light functions are read from, and the eye their fade is measured
 *  from: the atlas (a texture of words, read by load) in group `group`, and `eye`, the WGSL
 *  expression of the eye's world position. */
export interface LightFunctionBindings {
  readonly group: number
  readonly atlas: number
  readonly eye: string
  /** Whether the atlas is bound as a read-only storage texture, which spends none of the stage's
   *  sampled textures, or as a sampled one (`lightFunctionLayoutEntry`). */
  readonly storage?: boolean
}

/** The bindings as a block name reads them. */
export const lightFunctionBindingsLabel = (b?: LightFunctionBindings) =>
  b ? `${b.group}, ${b.atlas}, ${b.eye}${b.storage ? ', storage' : ''}` : 'none'

/** What a program that reads no light function answers: white, a light unchanged. */
export const NO_LIGHT_FUNCTION_WGSL = wgslBlock(
  'NO_LIGHT_FUNCTION_WGSL',
  [],
  'fn lightFunctionOf(word:f32,P:vec3f)->vec3f{return vec3f(1.0);}\nfn lightFunctionFogLocalOf(word:f32,P:vec3f)->vec3f{return vec3f(1.0);}',
)

/**
 * THE LIGHT FUNCTION READ: the colour a light gives at the world point `P` is its colour times
 * `lightFunctionOf(word, P)`, `word` the light's kind word. The light's entry is read from the table
 * under the slots of the atlas (`layout.ts`); the point is taken to the light's axes and, by the
 * light's kind, to a coordinate in the slot of its material: a spot's and a rectangle's cone as
 * the tangent of its cone says, a point's by its direction as longitude and latitude, any other (a
 * sun, a rectangle without a cone) by the axes themselves; the coordinate wraps. The slot is read
 * bilinear, clamped to the atlas's edge, and squared (the atlas holds the square root of the colour).
 * The function then fades to the light's disabled brightness over the fifth of its fade distance
 * that ends at it, by the distance from the eye. An index of 0, or one the atlas holds no row for
 * (the stand-in's texel), answers white.
 */
export const lightFunctionReadWgsl = (b: LightFunctionBindings) =>
  wgslBlock(
    `lightFunctionReadWgsl(${lightFunctionBindingsLabel(b)})`,
    [],
    `@group(${b.group}) @binding(${b.atlas}) var lightFunctionAtlas:${
      b.storage ? 'texture_storage_2d<rgba32uint,read>' : 'texture_2d<u32>'
    };
fn lightFunctionLoad(texel:vec2u)->vec4u{return textureLoad(lightFunctionAtlas,texel${b.storage ? '' : ',0'});}
const LF_PI:f32=3.14159265358979;
const LF_SHIFT:u32=${LIGHT_FUNCTION_SHIFT}u;
const LF_ENTRY:u32=${ENTRY_VEC4S}u;
const LF_POINT:u32=${KINDS.point}u;
const LF_SPOT:u32=${KINDS.spot}u;
const LF_RECT:u32=${KINDS.rect}u;
fn lightFunctionTexel(texel:vec2i)->vec3f{
 let last=vec2i(i32(textureDimensions(lightFunctionAtlas).x)-1);
 return bitcast<vec4f>(lightFunctionLoad(vec2u(clamp(texel,vec2i(0),last)))).rgb;
}
/** The atlas at \`uv\` of its slots, bilinear and clamped to the edge as a sampler's. */
fn lightFunctionBilinear(uv:vec2f)->vec3f{
 let side=f32(textureDimensions(lightFunctionAtlas).x);
 let at=uv*side-vec2f(0.5);
 let corner=floor(at);
 let g=at-corner;
 let c=vec2i(corner);
 let low=mix(lightFunctionTexel(c),lightFunctionTexel(c+vec2i(1,0)),g.x);
 let high=mix(lightFunctionTexel(c+vec2i(0,1)),lightFunctionTexel(c+vec2i(1,1)),g.x);
 return mix(low,high,g.y);
}
/** Texel \`t\` of the table: its words as floats. */
fn lightFunctionWord(t:u32)->vec4f{
 let side=textureDimensions(lightFunctionAtlas).x;
 return bitcast<vec4f>(lightFunctionLoad(vec2u(t%side,side+t/side)));
}
fn lightFunctionEye()->vec3f{return ${b.eye};}
fn lightFunctionOf(word:f32,P:vec3f)->vec3f{
 let index=u32(word)>>LF_SHIFT;
 if(index==0u){return vec3f(1.0);}
 let dims=textureDimensions(lightFunctionAtlas);
 let first=index*LF_ENTRY;
 if(dims.x+(first+LF_ENTRY-1u)/dims.x>=dims.y){return vec3f(1.0);}
 let head=lightFunctionWord(first);
 let words=vec2u(bitcast<u32>(head.y),bitcast<u32>(head.z));
 let kind=words.x&0xFFu;
 let disabled=unpack2x16float((words.x>>8u)&0xFFFFu).x;
 let corner=vec2f(f32(words.y&0xFFFFu),f32(words.y>>16u))/65536.0;
 let placed=P.x*lightFunctionWord(first+1u)+P.y*lightFunctionWord(first+2u)+P.z*lightFunctionWord(first+3u)+lightFunctionWord(first+4u);
 let axes=vec3f(placed.z,placed.y,placed.x)/placed.w;
 var uv=axes.xy;
 if(kind==LF_SPOT||(kind==LF_RECT&&head.w>0.0)){
  uv=axes.xy/(axes.z*head.w)*0.5+0.5;
 }else if(kind==LF_POINT){
  let dir=normalize(axes);
  uv=vec2f((atan2(dir.y,dir.x)+LF_PI)/(2.0*LF_PI),acos(clamp(dir.z,-1.0,1.0))/LF_PI);
 }
 let slotSize=lightFunctionWord(${ATLAS_NUMBERS_AT}u).x;
 let sampled=lightFunctionBilinear(corner+saturate(fract(uv))*slotSize);
 let distance=length(lightFunctionEye()-P);
 let fade=saturate((head.x-distance)/(head.x*0.2));
 return mix(vec3f(disabled),sampled*sampled,fade);
}
/** The same for a local light of the volumetric fog: white where the fog's local lights are set not
 *  to read the light functions (\`lightFunctionFog\`); the fog's sun always reads them. */
fn lightFunctionFogLocalOf(word:f32,P:vec3f)->vec3f{
 let dims=textureDimensions(lightFunctionAtlas);
 if((u32(word)>>LF_SHIFT)==0u||dims.y<=dims.x||lightFunctionWord(${ATLAS_NUMBERS_AT}u).w<0.5){return vec3f(1.0);}
 return lightFunctionOf(word,P);
}`,
  )
