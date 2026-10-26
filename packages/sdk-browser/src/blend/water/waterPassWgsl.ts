import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fresnelSchlick } from '../../../../math/src/wgsl/lighting.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { WATER_COPY_BINDINGS as C, WATER_MASK_BINDINGS as M } from './waterLayout.ts'
import { WATER_MATH_WGSL } from './waterMathWgsl.ts'
import { waterTileVertexWgsl } from './waterTileWgsl.ts'

/**
 * THE WATER PASS'S FULL-SCREEN PROGRAMS, each its own module with its uniform `water` in group 0.
 *
 * THE COPIES OF THE SCENE WITHOUT THE WATER, at `water.modes.w` (1 or 2) times fewer pixels a side:
 * `fsWaterDepthCopy`, its linear depth (the clip w; the furthest of the block's texels when the copy is
 * downsampled, so that an edge never reads a depth nearer than what shows), and `fsWaterColorCopy`, its
 * colour (the bilinear mean of the block), the second also drawn for the tiles of the list alone
 * (`waterTileVertex`, the list at binding 4) where the scene is copied only where the water is.
 * Bindings: `WATER_COPY_BINDINGS`.
 *
 * THE MASK (`fsWaterMask`): the share of its refraction a water pixel keeps, packed with the flag
 * that it is water (`waterMaskPack`); a pixel the water's depth (the prepass's copy of the scene's depth,
 * written over where the water is nearest) did not change is no water, mask 0. The share is the
 * product of the three cullings a setting asks for (`water.distanceRange`, `fresnelRange`,
 * `depthRange`, each `x` the end of the fade where the refraction is kept, `y` the end where it is
 * gone, `z` 1 where it is on): the distance from the camera to the water, the Fresnel
 * reflectance of the water's flat normal (Schlick on 0.04, from the screen derivatives of its
 * position) and the depth of water over the scene behind it. Bindings: `WATER_MASK_BINDINGS`.
 */
const COPY_WGSL = wgslBlock(
  'WATER_COPY_WGSL',
  [WATER_MATH_WGSL, waterTileVertexWgsl(0, C.tiles)],
  `@group(0) @binding(${C.params}) var<uniform> water:WaterParams;
@group(0) @binding(${C.color}) var sceneColor:texture_2d<f32>;
@group(0) @binding(${C.depth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${C.sampler}) var bilinear:sampler;
@fragment fn fsWaterDepthCopy(@builtin(position) position:vec4f)->@location(0) f32{
 let factor=i32(water.modes.w);
 let size=vec2f(water.tiles.zw);
 let first=vec2i(position.xy)*factor;
 var depth=0.0;
 for(var y=0;y<factor;y++){
  for(var x=0;x<factor;x++){
   let at=min(first+vec2i(x,y),vec2i(size)-vec2i(1));
   depth=max(depth,waterLinearDepth(vec2f(at)+0.5,size,textureLoad(sceneDepth,at,0)));
  }
 }
 return depth;
}
@fragment fn fsWaterColorCopy(@builtin(position) position:vec4f)->@location(0) vec4f{
 let size=vec2f(textureDimensions(sceneColor));
 let uv=(position.xy+0.5)*f32(water.modes.w)/size;
 return vec4f(textureSampleLevel(sceneColor,bilinear,uv,0.0).rgb,1.0);
}`,
)

const MASK_WGSL = wgslBlock(
  'WATER_MASK_WGSL',
  [WATER_MATH_WGSL, fresnelSchlick],
  `@group(0) @binding(${M.params}) var<uniform> water:WaterParams;
@group(0) @binding(${M.waterDepth}) var waterDepthTexture:texture_depth_2d;
@group(0) @binding(${M.opaqueDepth}) var opaqueDepth:texture_depth_2d;
@group(0) @binding(${M.sceneLinear}) var sceneLinear:texture_2d<f32>;
fn faded(value:f32,range:vec4f)->f32{
 if(range.z==0.0){return 1.0;}
 return 1.0-smoothstep(range.x,range.y,value);
}
@fragment fn fsWaterMask(@builtin(position) position:vec4f)->@location(0) f32{
 let at=vec2i(position.xy);
 let size=vec2f(water.tiles.zw);
 let z=textureLoad(waterDepthTexture,at,0);
 // The derivatives are taken before the early return, in uniform flow.
 let linear=waterLinearDepth(position.xy,size,z);
 let p=waterWorldAt(position.xy,size,linear);
 let dx=dpdxFine(p);let dy=dpdyFine(p);
 if(z<=textureLoad(opaqueDepth,at,0)){return waterMaskPack(false,0.0);}
 let toWater=p-water.eye.xyz;
 var share=faded(length(toWater),water.distanceRange);
 let V=normalize(-toWater);
 let N=normalize(cross(dx,dy));
 share*=faded(fresnelSchlick(vec3f(0.04),1.0,abs(dot(V,N))).g,water.fresnelRange);
 let behind=textureLoad(sceneLinear,at/vec2i(i32(water.modes.w)),0).r;
 share*=faded(behind-linear,water.depthRange);
 return waterMaskPack(true,share);
}`,
)

/** The copies' program text. */
export const waterCopyShader = () => wgslModule(COPY_WGSL, FULLSCREEN_VERTEX)
/** The mask's program text. */
export const waterMaskShader = () => wgslModule(MASK_WGSL, FULLSCREEN_VERTEX)
