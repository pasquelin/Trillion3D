import { REFLECTION_CONE_TRACE_WGSL } from './coneShader.ts'
import { REFLECTION_CONE_FILTER_WGSL } from './coneFilterShader.ts'

export const REFLECTION_CONE_WGSL = `
@group(1) @binding(4) var reflectionBounds:texture_2d<f32>;
fn reflectionLastMip()->f32{return f32(textureNumLevels(reflectionColor)-1u);}
fn reflectionBoundsLevels()->i32{return i32(textureNumLevels(reflectionBounds));}
fn reflectionBoundsAt(p:vec2i,level:i32)->vec2f{
 if(level==0){return reflectionPixelBounds(p);}
 let size=vec2i(textureDimensions(reflectionBounds,level-1));
 return textureLoad(reflectionBounds,clamp(p,vec2i(0),size-vec2i(1)),level-1).rg;
}
fn reflectionMipColorAt(p:vec2i,level:i32)->vec4f{
 let size=vec2i(textureDimensions(reflectionColor,level));
 return textureLoad(reflectionColor,clamp(p,vec2i(0),size-vec2i(1)),level);
}
${REFLECTION_CONE_FILTER_WGSL}
${REFLECTION_CONE_TRACE_WGSL}
`
