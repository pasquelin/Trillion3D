import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DOF_COC_WGSL, DOF_DOWNSAMPLE_WGSL, DOF_PARAMS_WGSL } from './dofCommonWgsl.ts'
import { COC_FORMAT, COLOR_FORMAT, GROUP } from './dofLayout.ts'

/** The setup's bindings: the image, the depth, the half-size colour and the circle of confusion. */
export const SETUP_BINDINGS = { scene: 2, depth: 3, color: 4, coc: 5 } as const
/** The downsample's: the colour and circle of confusion read, the quarter-size ones written. */
export const DOWNSAMPLE_BINDINGS = { color: 2, coc: 3, outColor: 4, outCoc: 5 } as const

/** The depth at a texel of the image, which the depth, of the render's size, is read at the texel
 *  under its centre; `sceneCoc` the circle of confusion there, in texels of the gather's width. */
const SETUP_INPUTS_WGSL = wgslBlock(
  'SETUP_INPUTS_WGSL',
  [DOF_PARAMS_WGSL, DOF_COC_WGSL],
  `
@group(0) @binding(${SETUP_BINDINGS.scene}) var sceneTexture:texture_2d<f32>;
@group(0) @binding(${SETUP_BINDINGS.depth}) var depthTexture:texture_depth_2d;
@group(0) @binding(${SETUP_BINDINGS.color}) var colorOut:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${SETUP_BINDINGS.coc}) var cocOut:texture_storage_2d<${COC_FORMAT},write>;
fn depthTexel(p:vec2i)->vec2i{
 return clamp(vec2i(floor((vec2f(p)+0.5)*view.depthMap.xy)),vec2i(0),vec2i(view.depthMap.zw));
}
fn sceneCoc(p:vec2i)->f32{
 return cocOfDepth(sceneDepthOf(textureLoad(depthTexture,depthTexel(p),0)),view.basis.x);
}`,
)

/**
 * The setup at half the image's size (a gather divisor of 2): each texel takes the four texels of
 * the image under it, the circle of confusion of each from its depth, and downsamples them to a
 * colour and one circle (`dofDownsample`, the smallest circle's operator); a texel past the image's
 * edge reads the edge's. A workgroup of `GROUP` texels a side.
 */
export const setupHalfShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn setupHalf(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=view.gather.xy)){return;}
 let texel=vec2i(gid.xy);
 let last=vec2i(view.image.xy)-vec2i(1);
 var colors:array<vec4f,4>;
 var cocs=vec4f(0.0);
 for(var i=0;i<4;i++){
  let p=min(texel*2+vec2i(i%2,i/2),last);
  colors[i]=textureLoad(sceneTexture,p,0);
  cocs[i]=sceneCoc(p);
 }
 let down=dofDownsample(colors,cocs,1.0,true);
 textureStore(colorOut,texel,down.color);
 textureStore(cocOut,texel,vec4f(down.coc,0.0,0.0,0.0));
}`,
    [SETUP_INPUTS_WGSL, DOF_DOWNSAMPLE_WGSL],
  )

/** The setup at the image's size (a gather divisor of 1): the circle of confusion of each texel
 *  alone, the image itself being the gather's colour. */
export const setupFullShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn setupFull(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=view.image.xy)){return;}
 textureStore(cocOut,vec2i(gid.xy),vec4f(sceneCoc(vec2i(gid.xy)),0.0,0.0,0.0));
}`,
    [SETUP_INPUTS_WGSL],
  )

/**
 * The quarter-size copy the scatter's decision compares against (`downsampleCoc`): each texel takes
 * the four of the half-size setup under it — clamped to the setup's last texel — and downsamples them
 * (the first-smaller circle's operator). A workgroup of `GROUP` texels a side.
 */
export const cocDownsampleShader = () =>
  wgslProgram(
    `@group(0) @binding(${DOWNSAMPLE_BINDINGS.color}) var colorIn:texture_2d<f32>;
@group(0) @binding(${DOWNSAMPLE_BINDINGS.coc}) var cocIn:texture_2d<f32>;
@group(0) @binding(${DOWNSAMPLE_BINDINGS.outColor}) var colorOut:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${DOWNSAMPLE_BINDINGS.outCoc}) var cocOut:texture_storage_2d<${COC_FORMAT},write>;
@compute @workgroup_size(${GROUP},${GROUP})
fn downsampleCoc(@builtin(global_invocation_id) gid:vec3u){
 let size=(view.gather.xy+vec2u(1u))/2u;
 let quarter=vec2i(gid.xy);
 let last=vec2i(view.gather.xy)-vec2i(1);
 var colors:array<vec4f,4>;
 var cocs=vec4f(0.0);
 for(var i=0;i<4;i++){
  let p=min(quarter*2+vec2i(i%2,i/2),last);
  colors[i]=textureLoad(colorIn,p,0);
  cocs[i]=textureLoad(cocIn,p,0).x;
 }
 let down=dofDownsample(colors,cocs,1.0,false);
 if(all(gid.xy<size)){
  textureStore(colorOut,quarter,down.color);
  textureStore(cocOut,quarter,vec4f(down.coc,0.0,0.0,0.0));
 }
}`,
    [DOF_PARAMS_WGSL, DOF_DOWNSAMPLE_WGSL],
  )
