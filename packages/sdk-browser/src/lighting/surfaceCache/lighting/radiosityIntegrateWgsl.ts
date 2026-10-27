import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'
import { radiosityCommonWgsl, radiosityProbeVisibilityWgsl } from './radiosityCommonWgsl.ts'

/**
 * THE INDIRECT LIGHT OF THE CARDS' TEXELS: a workgroup a tile of the indirect update's list, a thread a texel, which holds the
 * light its four nearest probes' harmonics give its normal, kept in the indirect layer.
 *
 * A texel's probes are the four of the card's grid around it — found as the jittered grid lays them: the texel's place on
 * the card less its page's jitter, over the spacing —, each weighted bilinearly (`BILINEAR_EXPAND` one texel wider on each side, so that no
 * probe weighs nothing where the others are left out) and left out if its page holds no lit probe, it lies off its page or on no surface,
 * or off the texel's plane (`probeHarmonics`, the plane test of the filter's), or, with the probes' occlusion on, where the probe's
 * rays met a surface nearer than the texel on the line to it (`probeVisibility`). Their weighted harmonics are
 * dotted with the cosine lobe at the texel's normal — the first band times π, the second 2π over 3 —, never under
 * zero, over the weights' sum. Where the radiosity blends over the images the result is blended into what the layer holds: by
 * `1 / (1 + n)`, `n` the images the tile has blended — one more each image, to the pattern's length, from none after its
 * page's radiosity was emptied (`frames`, a word a tile, one thread of the tile counting) —, dithered in the last place of the
 * word it is kept in, so that a small step is not lost.
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context, 3 and 4 the depth and normal layers, 5 the
 * probes' harmonics, one layer a channel, 6 the indirect light, read and written, 7 the tiles' count of images, read and written, 8 the distances the rays
 * met their surfaces at (read where the probes' occlusion is on).
 */

export const RADIOSITY_INTEGRATE_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  harmonics: 5,
  indirect: 6,
  frames: 7,
  hits: 8,
} as const

const B = RADIOSITY_INTEGRATE_BINDINGS

export const RADIOSITY_INTEGRATE_ENTRY = 'radiosityIntegrate'

export const RADIOSITY_INTEGRATE_WGSL = wgslProgram(
  `const BILINEAR_EXPAND:f32=1.0;
@group(0) @binding(${B.harmonics}) var probeHarmonics:texture_2d_array<f32>;
@group(0) @binding(${B.indirect}) var indirectAtlas:texture_storage_2d<r32uint,read_write>;
@group(0) @binding(${B.frames}) var framesAtlas:texture_storage_2d<r32uint,read_write>;
var<workgroup> framesBlended:f32;
fn harmonicsAt(at:vec2u)->mat3x4f{
 let c=vec2i(at);
 return mat3x4f(textureLoad(probeHarmonics,c,0,0),textureLoad(probeHarmonics,c,1,0),textureLoad(probeHarmonics,c,2,0));
}
/** Adds the probe \`probe\` of the card of \`page\`'s mip to \`sum\`, weighted by \`weight\` where it counts. */
fn addProbe(texel:RadTexel,page:u32,probe:vec2u,weight:f32,sum:ptr<function,mat3x4f>,total:ptr<function,f32>){
 let sizeInProbes=cardSizeInProbes(page);
 if(any(probe>=sizeInProbes)){return;}
 let at=cardProbeTexel(page,sizeInProbes,probe);
 if(!(at.inside&&at.valid)){return;}
 var w=weight;
 if(lgFlag(FLAG_PLANE_WEIGHTING)){w=min(w,planeWeight(texel.position,texel.normal,at.position));}
 if(lgFlag(FLAG_PROBE_OCCLUSION)){w=min(w,probeVisibility(texel.position,at));}
 if(w>0.0){*sum=*sum+harmonicsAt(probeAtlasCoord(at.atlas))*w;*total+=w;}
}
@compute @workgroup_size(8,8,1)
fn ${RADIOSITY_INTEGRATE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_INDIRECT)){return;}
 let packed=ctxTile(LG_LIST_INDIRECT,tile);
 let page=tilePage(packed);
 let tileCoord=tileCoordOf(packed);
 let texel=radTexel(page,tileCoord*LG_TILE+at.xy);
 let tileAtlas=vec2i((pageMin(page)+tileCoord*LG_TILE)/vec2u(LG_TILE));
 if(lane==0u){
  var blended=0.0;
  if(lgFlag(FLAG_TEMPORAL)){blended=min(f32(textureLoad(framesAtlas,tileAtlas).x)+1.0,f32(lp.maxFrames));}
  framesBlended=blended;
  textureStore(framesAtlas,tileAtlas,vec4u(u32(blended),0u,0u,0u));
 }
 workgroupBarrier();
 if(!(texel.inside&&texel.valid)){
  if(texel.inside){textureStore(indirectAtlas,vec2i(texel.atlas),vec4u(0u));}
  return;
 }
 let inCard=texel.cardCoord;
 let full=vec2u(max(vec2f(inCard)-vec2f(pageJitter(page)),vec2f(0.0)));
 let corner=full>>vec2u(lp.spacingShift);
 let along=(vec2f(full)-vec2f(corner*lp.spacing)+BILINEAR_EXPAND)/(f32(lp.spacing)+2.0*BILINEAR_EXPAND);
 var sum=mat3x4f();
 var total=0.0;
 addProbe(texel,page,corner,(1.0-along.x)*(1.0-along.y),&sum,&total);
 addProbe(texel,page,corner+vec2u(1u,0u),along.x*(1.0-along.y),&sum,&total);
 addProbe(texel,page,corner+vec2u(0u,1u),(1.0-along.x)*along.y,&sum,&total);
 addProbe(texel,page,corner+vec2u(1u,1u),along.x*along.y,&sum,&total);
 let normal=texel.normal;
 let transfer=tvBasis(normal)*vec4f(TV_L0,TV_L1,TV_L1,TV_L1);
 var radiance=max(vec3f(dot(sum[0],transfer),dot(sum[1],transfer),dot(sum[2],transfer)),vec3f(0.0));
 if(total>0.0){radiance/=total;}
 if(lgFlag(FLAG_TEMPORAL)){
  let history=unpackLight(textureLoad(indirectAtlas,vec2i(texel.atlas)).x);
  let seed=vec3i(i32(texel.atlas.x),i32(texel.atlas.y),i32(texel.temporal)+2);
  radiance=ditherLight(mix(history,radiance,1.0/(1.0+framesBlended)),f32(rand3dPcg16(seed).x)/65536.0);
 }
 textureStore(indirectAtlas,vec2i(texel.atlas),vec4u(packLight(radiance),0u,0u,0u));
}`,
  [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
    radiosityCommonWgsl(),
    radiosityProbeVisibilityWgsl(B.hits),
    packLight,
    unpackLight,
    ditherLight,
    rand3dPcg16,
  ],
)
