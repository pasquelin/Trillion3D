import { ON_BORDER } from '../overlayWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

/**
 * THE PROFILE ATLAS'S DEBUG VIEW, in WGSL (`lightProfileAtlasDebug`): the atlas drawn small at the top left of the image as a square grid of
 * its slices, each slice a profile is in showing the profile, a green border round it, a free slice a grey border (a compute pass writing a
 * texture of the picture's size, laid over the image by `../overlayBlit.ts`). The figures are written as text by the debug lines (`debug.ts`).
 */

/** The left and the top of the atlas's picture, in display pixels, and the share of the display's width it takes. */
const PROFILE_DEBUG_OFFSET = [50, 220] as const
const PROFILE_DEBUG_SCALE = 0.25

/** The pixels of the display the atlas's picture takes (the atlas is square): the pass dispatches over them alone. */
export const profileDebugRect = (displayWidth: number) => {
  const width = Math.max(1, Math.floor(displayWidth * PROFILE_DEBUG_SCALE))
  return { x: PROFILE_DEBUG_OFFSET[0], y: PROFILE_DEBUG_OFFSET[1], width, height: width }
}

export const PROFILE_DEBUG_WGSL = wgslProgram(
  `
struct DebugFigures{atlas:vec2u,shown:vec2u,sliceCount:u32,}
@group(0) @binding(0) var<uniform> figures:DebugFigures;
@group(0) @binding(1) var<storage,read> usedSlices:array<u32>;
@group(0) @binding(2) var atlasSampler:sampler;
@group(0) @binding(3) var atlasTexture:texture_2d_array<f32>;
@group(0) @binding(4) var result:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(8,8,1) fn mainCs(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=figures.shown)){return;}
 let atlas=vec2f(figures.atlas);
 let grid=u32(ceil(sqrt(f32(figures.sliceCount))));
 let slotSize=figures.atlas/vec2u(grid);
 let shown=figures.shown;
 var out=vec4f(0.0);
 if(all(id.xy>vec2u(0u))){
  let uv=vec2f(id.xy)/vec2f(shown);
  if(all(uv<vec2f(1.0))){
   let width=atlas.x/f32(shown.x)*2.0;
   let slotUv=fract(uv*f32(grid));
   let index=u32(floor(uv.x*f32(grid)))+u32(floor(uv.y*f32(grid)))*grid;
   var colour=vec4f(0.0);
   if(index<figures.sliceCount){
    let valid=usedSlices[index]>0u;
    if(valid){colour=textureSampleLevel(atlasTexture,atlasSampler,slotUv,index,0.0);}
    if(onBorder(slotUv*vec2f(slotSize),vec2f(0.0),vec2f(slotSize.x),width)){
     colour=select(vec4f(0.5,0.5,0.5,1.0),vec4f(0.0,1.0,0.0,1.0),valid);
    }
   }
   out=vec4f(colour.xyz,1.0);
  }
 }
 textureStore(result,id.xy,out);
}`,
  [ON_BORDER],
)
