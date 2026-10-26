import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { equalAreaDecode } from '../../../../math/src/wgsl/octahedral.ts'
import { SP_REFLECTION } from '../bounce/screen/commonWgsl.ts'
import { TV_SH_WGSL } from '../translucency/frameWgsl.ts'
import { GI_QUANTIZE_WGSL, GI_SAMPLE_WGSL, GI_VISIBLE_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_GI_FORMAT, TRANSLUCENCY_GI_GROUP } from './layout.ts'

/** Where the integration binds what it reads and writes, in group 0 (the view and the depth pyramid are group 1, `SP_REFLECTION`): the
 *  frame, the filtered cones' light, the volume of the image before, the sampler it is read through and the volume written. */
export const INTEGRATE_GI_BINDING = {
  frame: 0,
  cones: 1,
  history: 2,
  sampler: 3,
  volume: 4,
} as const
const b = INTEGRATE_GI_BINDING

/**
 * THE INTEGRATION OF THE CONES INTO THE TWO-BAND HARMONICS, a thread a cell. A cell worth tracing (`giVisible`) sums its cones' light,
 * divided by the pre-exposure it was traced multiplied by, times the harmonics' basis of the cone's direction (the constant band and the
 * three linear ones), and times `π` over the cones' count; the sum is four times what that gives, the factor the reading takes out
 * again. Where the history holds (`gi.temporal.y`), the volume of the image before is read at the point the cell's centre lay at in it
 * (the previous view-projection `gi.previous`, set at the eye of that image: the place relative to this image's eye, moved by the eye's travel `gi.eyeMoved`), trilinear — its ambient light as it is, its directional light's luminance given the
 * ambient light's colour — and blended in by the history's weight; a point off the image or off the depths of the grid takes none, a cell
 * not seen keeps the history whole. What it writes is the volume the surfaces read, and the history of the next image: the ambient light
 * (the constant band, written to the format's precision: `giQuantize`) in the first half of the slices, the luminance of each linear band in the second.
 */
const INTEGRATE_GI_WGSL = wgslBlock(
  'INTEGRATE_GI_WGSL',
  [GI_VISIBLE_WGSL, GI_SAMPLE_WGSL, GI_QUANTIZE_WGSL, TV_SH_WGSL, equalAreaDecode, luminance, PI],
  `const GI_INTENSITY:f32=4.0;
struct GiHarmonics{c:array<vec3f,4>,}
fn giProject(cell:vec3u)->GiHarmonics{
 var sh=GiHarmonics(array<vec3f,4>(vec3f(0.0),vec3f(0.0),vec3f(0.0),vec3f(0.0)));
 let res=u32(gi.trace.x);
 for(var y=0u;y<res;y++){for(var x=0u;x<res;x++){
  let light=textureLoad(cones,vec3i(vec2i(cell.xy*res+vec2u(x,y)),i32(cell.z)),0).xyz*gi.trace.w;
  let basis=tvBasis(equalAreaDecode((vec2f(f32(x),f32(y))+vec2f(0.5))/f32(res)));
  for(var k=0;k<4;k++){sh.c[k]+=light*basis[k];}
 }}
 let scale=GI_INTENSITY*PI/f32(res*res);
 for(var k=0;k<4;k++){sh.c[k]*=scale;}
 return sh;
}
struct GiPast{sh:GiHarmonics,ok:bool,}
fn giHistory(cell:vec3u)->GiPast{
 var past=GiPast(GiHarmonics(array<vec3f,4>(vec3f(0.0),vec3f(0.0),vec3f(0.0),vec3f(0.0))),false);
 let clip=gi.previous*vec4f(giCellOffset(vec3f(cell),vec3f(0.5))+gi.eyeMoved.xyz,1.0);
 if(clip.w<=0.0){return past;}
 let slices=f32(gi.grid.z);
 let uvw=giVolumeCoord(clip,gi.zParams,slices);
 if(any(uvw<vec3f(0.0))||any(uvw>=vec3f(1.0))){return past;}
 let light=giSampleVolume(history,historySampler,uvw,slices);
 let tint=light[0]/(luminance(light[0])+0.00001);
 past.sh.c[0]=light[0];
 for(var k=0;k<3;k++){past.sh.c[k+1]=tint*light[1][k];}
 past.ok=true;
 return past;
}
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn integrateCells(@builtin(global_invocation_id) id:vec3u){
 if(any(id>=gi.grid.xyz)){return;}
 let seen=giVisible(id);
 var sh=GiHarmonics(array<vec3f,4>(vec3f(0.0),vec3f(0.0),vec3f(0.0),vec3f(0.0)));
 if(seen){sh=giProject(id);}
 var alpha=select(1.0,gi.temporal.x,seen);
 if(gi.temporal.y!=0.0&&alpha>0.0){
  let past=giHistory(id);
  let keep=select(0.0,alpha,past.ok);
  for(var k=0;k<4;k++){sh.c[k]=mix(sh.c[k],past.sh.c[k],keep);}
 }
 let slices=gi.grid.z;
 textureStore(volume,id,vec4f(giQuantize(sh.c[0],id.xy,id.z),0.0));
 textureStore(volume,vec3u(id.xy,id.z+slices),vec4f(luminance(sh.c[1]),luminance(sh.c[2]),luminance(sh.c[3]),0.0));
}`,
)

/** The integration's program. */
export const INTEGRATE_GI_PROGRAM = wgslProgram(
  `@group(0) @binding(${b.frame}) var<uniform> gi:TranslucencyGiFrame;
@group(0) @binding(${b.cones}) var cones:texture_3d<f32>;
@group(0) @binding(${b.history}) var history:texture_3d<f32>;
@group(0) @binding(${b.sampler}) var historySampler:sampler;
@group(0) @binding(${b.volume}) var volume:texture_storage_3d<${TRANSLUCENCY_GI_FORMAT},write>;`,
  [SP_REFLECTION, INTEGRATE_GI_WGSL],
)
