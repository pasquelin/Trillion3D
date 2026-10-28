import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../lighting/deferred/worldAtWgsl.ts'
import { VOLUMETRIC_IRRADIANCE_WGSL } from '../lighting/deferred/volumetricLightWgsl.ts'
import { volumetricLightmapWgsl } from '../lighting/volumetricLightmap/sampleWgsl.ts'
import { hairScatteringWgsl } from './hairBsdfWgsl.ts'
import { HAIR_SAMPLE_WGSL } from './sampleWgsl.ts'
import { HAIR_NODE_COUNTER_STORED, HAIR_NODE_GROUP_SIZE } from './visibilityMath.ts'

/** The binding of the lightmap's first resource in group 0 (`volumetricLightmapWgsl`); its other resources follow it. */
export const HAIR_STATIC_LIGHTMAP_FIRST = 0
/** The bindings of the kernel's own group (group 1): the samples, the table of the fibre's scattering and its sampler, the parameters (the BSDF's components), the lighting's view and the grid written. */
export const HAIR_STATIC_GROUP = {
  nodeCoord: 0,
  nodeData: 1,
  nodeCounter: 2,
  lut: 3,
  params: 5,
  view: 6,
  out: 7,
} as const
/** The entry point of the kernel. */
export const HAIR_STATIC_ENTRY = 'hairStaticLight'

const G = HAIR_STATIC_GROUP

/** The occlusion that multiplies the bounces of a surface of albedo `albedo` seen under the occlusion `ao`: the polynomial the lightmap's light is weighed by. */
const AO_MULTI_BOUNCE = wgslBlock(
  'HAIR_AO_MULTI_BOUNCE',
  [],
  `fn hairAoMultiBounce(albedo:vec3f,ao:f32)->vec3f{
 let a=2.0404*albedo-vec3f(0.3324);
 let b=-4.7951*albedo+vec3f(0.6417);
 let c=2.7552*albedo+vec3f(0.6903);
 return max(vec3f(ao),((vec3f(ao)*a+b)*ao+c)*ao);
}`,
)

/**
 * THE STATIC LIGHT OF THE STRANDS, from the volumetric lightmap where the world is lit by no probe: for each sample that does not scatter the scene's light, the lightmap's third-order
 * harmonics at its point, their irradiance along the direction the fibre is lit from (the view's direction less its part along the fibre), over `PI`, times the fibre's response to that
 * direction (`evaluateEnvHair`), the multi-bounce occlusion of its colour under no occlusion, the pre-exposure and the share of the pixel it covers. Written to the grid the strands' sky pass adds
 * to the sky light.
 */
export const hairStaticLightWgsl = wgslProgram(
  `@group(1) @binding(${G.nodeCoord}) var<storage,read> hairCoord:array<u32>;
@group(1) @binding(${G.nodeData}) var<storage,read> hairData:array<u32>;
@group(1) @binding(${G.nodeCounter}) var<storage,read> hairCounter:array<u32>;
struct HairStaticParams{components:u32,pad0:u32,pad1:u32,pad2:u32}
@group(1) @binding(${G.params}) var<uniform> hairStatic:HairStaticParams;
@group(1) @binding(${G.view}) var<uniform> view:View;
@group(1) @binding(${G.out}) var hairStaticOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn ${HAIR_STATIC_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let index=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 let total=hairCounter[${HAIR_NODE_COUNTER_STORED}];
 if(index>=total){return;}
 let side=u32(ceil(sqrt(f32(total))));
 let at=vec2i(i32(index%side),i32(index/side));
 let strand=hairSampleOf(index);
 var light=vec3f(0.0);
 if(strand.scatter<0.5){
  let P=worldAt(vec2f(strand.pixel)+vec2f(0.5),strand.z);
  let V=viewToEye(P);
  let T=strand.tangent;
  let L=normalize(V-T*dot(V,T));
  let response=evaluateEnvHair(strand.colour,strand.roughness,strand.specular,strand.scatter,V,T,hairStatic.components);
  let irradiance=volumetricIrradiance(vlmSh3(vlmBrickUvs(P)),L)/PI;
  light=irradiance*response*hairAoMultiBounce(strand.colour,1.0)*view.preExposure.x;
 }
 textureStore(hairStaticOut,at,vec4f(max(light,vec3f(0.0))*strand.coverage,strand.coverage));
}`,
  [
    HAIR_SAMPLE_WGSL,
    hairScatteringWgsl(1, G.lut),
    PI,
    FLAT_INDEX_WGSL,
    VIEW_WGSL,
    WORLD_AT_WGSL,
    volumetricLightmapWgsl(0, HAIR_STATIC_LIGHTMAP_FIRST),
    VOLUMETRIC_IRRADIANCE_WGSL,
    AO_MULTI_BOUNCE,
  ],
)
