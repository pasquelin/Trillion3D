import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { NINE_OPERATORS_WGSL } from '../../taa/tileWgsl.ts'
import { DOF_LAYER_WGSL } from './dofLayerWgsl.ts'
import { COC_FORMAT, COLOR_FORMAT, GROUP } from './dofLayout.ts'

/** The post-filter's bindings: the colour and opacity of the layer, the two tile images, the colour
 *  and opacity filtered. */
export const POSTFILTER_BINDINGS = {
  color: 1,
  alpha: 2,
  tileFg: 3,
  tileBg: 4,
  outColor: 5,
  outAlpha: 6,
} as const

/** The post-filters, as the pipeline constant `METHOD` reads them. */
export const POSTFILTER_METHODS = { median: 1, max: 2 } as const

/**
 * The post-filter of a gathered layer (`LAYER` the foreground or the background): each channel of the
 * colour and of the opacity, over the 3 × 3 texels around, its median or, `METHOD` 2, its maximum
 * (the temporal passes' nine-value operators, `../../taa/tileWgsl.ts`), the neighbours
 * clamped to the gather's size. The maximum filter skips the tiles the gather skipped, writing 0 there
 * (`TILE`): nothing was gathered.
 */
export const dofPostfilterShader = () =>
  wgslProgram(
    `override METHOD:u32=1u;
override TILE:bool=false;
@group(0) @binding(${POSTFILTER_BINDINGS.color}) var colorIn:texture_2d<f32>;
@group(0) @binding(${POSTFILTER_BINDINGS.alpha}) var alphaIn:texture_2d<f32>;
@group(0) @binding(${POSTFILTER_BINDINGS.tileFg}) var tileFgTexture:texture_2d<f32>;
@group(0) @binding(${POSTFILTER_BINDINGS.tileBg}) var tileBgTexture:texture_2d<f32>;
@group(0) @binding(${POSTFILTER_BINDINGS.outColor}) var colorOut:texture_storage_2d<${COLOR_FORMAT},write>;
@group(0) @binding(${POSTFILTER_BINDINGS.outAlpha}) var alphaOut:texture_storage_2d<${COC_FORMAT},write>;
fn neighbourhood(source:texture_2d<f32>,p:vec2i)->vec4f{
 var v:array<vec4f,9>;
 let last=vec2i(view.gather.xy)-vec2i(1);
 for(var i=0;i<9;i++){
  v[i]=textureLoad(source,clamp(p+vec2i(i%3-1,i/3-1),vec2i(0),last),0);
 }
 if(METHOD==2u){return max9q(v);}
 return median9q(v);
}
@compute @workgroup_size(${GROUP},${GROUP})
fn postfilterLayer(@builtin(global_invocation_id) gid:vec3u,@builtin(workgroup_id) wg:vec3u){
 if(any(gid.xy>=view.gather.xy)){return;}
 let p=vec2i(gid.xy);
 if(TILE){
  let tile=cocTileRead(textureLoad(tileFgTexture,vec2i(wg.xy),0),textureLoad(tileBgTexture,vec2i(wg.xy),0));
  if(suggestFor(tile).early){
   textureStore(colorOut,p,vec4f(0.0));
   textureStore(alphaOut,p,vec4f(0.0));
   return;
  }
 }
 textureStore(colorOut,p,neighbourhood(colorIn,p));
 textureStore(alphaOut,p,neighbourhood(alphaIn,p));
}`,
    [DOF_LAYER_WGSL, NINE_OPERATORS_WGSL],
  )
