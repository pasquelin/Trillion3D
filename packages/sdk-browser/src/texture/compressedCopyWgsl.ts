import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';

export const COMPRESSED_COPY_WGSL = `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> extent:vec4u;
@fragment fn copyBlocks(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 var at=vec2i(pixel.xy);
 if(extent.z!=0u){at.y=i32(extent.y)-1-at.y;}
 var color=textureLoad(image,at,0);
 if(extent.w!=0u){color=vec4f(floor(color.rgb*color.a*255.0+vec3f(0.5))/255.0,color.a);}
 return color;
}`;
