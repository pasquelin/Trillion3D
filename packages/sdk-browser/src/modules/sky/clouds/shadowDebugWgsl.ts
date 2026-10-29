import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { gpuLineSink } from '../../../lighting/surfaceCache/sceneDebug/gpuLines.ts'

/** The threads along each side of a group of the debug kernel. */
export const CLOUD_SHADOW_DEBUG_GROUP = 8
/** The blue a quad is drawn with. */
const BLUE = 0.1

/**
 * THE CLOUD MAP'S DEBUG QUADS (`cloudShadowMapDebug`, `cloudSkyAODebug`): a thread for each texel of a map that holds cloud (a mean extinction above 0) appends the four edges of the texel's
 * quad, taken from the map's near plane (clip depth 1) to the world and moved along the map's rays by the depth where the cloud begins. The colour is the texel's place in the map: red along x,
 * green along y.
 *
 *   quad   uniform                 back: the matrix from clip space to centimetres from the camera, ray: the rays' direction, shift: the camera's place from the eye, metres
 *   map    texture_2d<f32>         depth where the cloud begins (kilometres), mean extinction, greatest optical depth
 */
export const CLOUD_SHADOW_DEBUG_WGSL = wgslProgram(
  `struct Quad{back:mat4x4f,ray:vec4f,shift:vec4f}
@group(0) @binding(0) var<uniform> quad:Quad;
@group(0) @binding(1) var map:texture_2d<f32>;
fn quadCorner(texel:vec2f,size:vec2f,front:f32)->vec3f{
 let clip=vec4f(texel/size*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),1.0,1.0);
 let h=quad.back*clip;
 return h.xyz/h.w/${CENTIMETRES_PER_METRE}.0+quad.ray.xyz*front+quad.shift.xyz;
}
@compute @workgroup_size(${CLOUD_SHADOW_DEBUG_GROUP},${CLOUD_SHADOW_DEBUG_GROUP}) fn cloudShadowDebug(@builtin(global_invocation_id) id:vec3u){
 let size=vec2f(textureDimensions(map));
 if(any(vec2f(id.xy)>=size)){return;}
 let data=textureLoad(map,vec2i(id.xy),0);
 if(data.y<=0.0){return;}
 let texel=vec2f(id.xy);
 let front=data.x*1000.0;
 let a=quadCorner(texel,size,front);
 let b=quadCorner(texel+vec2f(0.0,1.0),size,front);
 let c=quadCorner(texel+vec2f(1.0,1.0),size,front);
 let d=quadCorner(texel+vec2f(1.0,0.0),size,front);
 let color=pack4x8unorm(vec4f(texel/size,${BLUE},1.0));
 gpuLineWorld(a,b,color);
 gpuLineWorld(b,c,color);
 gpuLineWorld(c,d,color);
 gpuLineWorld(d,a,color);
}`,
  [gpuLineSink(2, 3)],
)
