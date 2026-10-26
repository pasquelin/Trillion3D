import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { INVERSE_PI } from '../../../../../math/src/wgsl/constants.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { lightingCommonWgsl } from './commonWgsl.ts'

/**
 * THE FINAL LIGHT OF THE CARDS' TEXELS: a workgroup a tile of a list of the update context, a thread a texel, which
 * holds what the surface sends back — the albedo it is decoded to (`scDecodeAlbedo`: squared, and, under a boost, lifted
 * in luminance) over π times the light it receives, the direct and the indirect — none while the radiosity is off —, plus its emission, none of it
 * under zero or not a number, a texel that is not on the page of an image's work left as it is. The light is
 * kept, as the direct and the indirect are, multiplied by the pre-exposure, and dithered in the last place of its word
 * by a hash of the texel and the image. `combineDirect` follows the direct light, over the direct list;
 * `combineIndirect` follows the radiosity, over its own.
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context, 3 the albedo (as stored: the square root of the colour), 4 the
 * emission (a layer of words of light, or a float texture where the atlas is compressed), 5 the direct light, 6 the
 * indirect light, 7 the final light, written.
 */

export const COMBINE_BINDINGS = {
  tables: 1,
  context: 2,
  albedo: 3,
  emissive: 4,
  direct: 5,
  indirect: 6,
  out: 7,
} as const

export const COMBINE_ENTRIES = ['combineDirect', 'combineIndirect'] as const

/** A channel that is a number, no infinity: its exponent is not all ones. */
const FINITE_WGSL = wgslBlock(
  'LIGHTING_FINITE_WGSL',
  [],
  `fn finiteLight(v:vec3f)->vec3f{
 let ones=vec3u(0x7f800000u);
 let finite=(bitcast<vec3u>(v)&ones)!=ones;
 return select(vec3f(0.0),max(v,vec3f(0.0)),finite);
}`,
)

/** The combine program of an atlas whose emission layer is, or is not, `compressed`. */
export const combineWgsl = (compressed: boolean) =>
  wgslProgram(
    `@group(0) @binding(${COMBINE_BINDINGS.albedo}) var albedoAtlas:texture_2d<f32>;
@group(0) @binding(${COMBINE_BINDINGS.emissive}) var emissiveAtlas:texture_2d<${compressed ? 'f32' : 'u32'}>;
@group(0) @binding(${COMBINE_BINDINGS.direct}) var directAtlas:texture_2d<u32>;
@group(0) @binding(${COMBINE_BINDINGS.indirect}) var indirectAtlas:texture_2d<u32>;
@group(0) @binding(${COMBINE_BINDINGS.out}) var outFinal:texture_storage_2d<r32uint,write>;
fn combine(list:u32,group:vec3u,n:vec3u,at:vec3u){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(list)){return;}
 let packed=ctxTile(list,tile);
 let page=tilePage(packed);
 let texel=vec2i(pageMin(page)+tileCoordOf(packed)*LG_TILE+at.xy);
 let albedo=scDecodeAlbedo(textureLoad(albedoAtlas,texel,0).xyz);
 let direct=unpackLight(textureLoad(directAtlas,texel,0).x);
 let indirect=select(vec3f(0.0),unpackLight(textureLoad(indirectAtlas,texel,0).x),lgFlag(FLAG_RADIOSITY));
 let emission=${compressed ? 'textureLoad(emissiveAtlas,texel,0).xyz' : 'unpackLight(textureLoad(emissiveAtlas,texel,0).x)'};
 let light=finiteLight((direct+indirect)*albedo*INVERSE_PI+emission);
 let noise=f32(rand3dPcg16(vec3i(texel.x,texel.y,i32(lp.frame%8u)+2)).x)/65536.0;
 textureStore(outFinal,texel,vec4u(packLight(ditherLight(light,noise)),0u,0u,0u));
}
@compute @workgroup_size(8,8,1)
fn combineDirect(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 combine(LG_LIST_DIRECT,group,n,at);
}
@compute @workgroup_size(8,8,1)
fn combineIndirect(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 combine(LG_LIST_INDIRECT,group,n,at);
}`,
    [
      lightingCommonWgsl({
        tables: COMBINE_BINDINGS.tables,
        context: { binding: COMBINE_BINDINGS.context, access: 'read' },
      }),
      FINITE_WGSL,
      INVERSE_PI,
      packLight,
      unpackLight,
      ditherLight,
      rand3dPcg16,
    ],
  )
