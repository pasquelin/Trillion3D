import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { AIR_TINT_WGSL } from '../atmosphere/airTintWgsl.ts'
import { cloudShadowReadWgsl } from '../atmosphere/cloudShadowRead.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { lightFunctionReadWgsl } from '../lightFunction/readWgsl.ts'
import { VSM_TRACE_KINDS_BOTH } from '../shadows/vsm/trace/traceWgsl.ts'
import { TV_FRAME_WGSL, TV_SH_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_WORKGROUP, VOLUME_FORMAT } from './layout.ts'

/** Where the injection binds what it reads and writes, in group 0: the light buffer, the frame, the lists of ranks
 *  of the lights each cascade is lit by, the texture written (`VOLUME_FORMAT`), the virtual shadow maps a light's shadow is read
 *  from (the page table, the projection's data, its uniforms, the pool's first slice and the projection's view),
 *  the light functions' atlas and the clouds' shade (the block, the two maps, the sampler). */
export const INJECT_BINDING = {
  lights: 0,
  frame: 1,
  ranks: 2,
  injected: 3,
  pageTable: 4,
  projectionData: 5,
  shadowUniforms: 6,
  pool: 7,
  shadowView: 8,
  lightFunction: 9,
  cloudShadow: 10,
  cloudShadowMap0: 11,
  cloudShadowMap1: 12,
  cloudShadowSampler: 13,
} as const
const b = INJECT_BINDING

/** A light's shadow, read as the fog volume reads it (`../fog/programs.ts`): one sample of the light's virtual
 *  shadow map at the cell's point, the sun's and a local light's alike. */
const SHADOW = directShadowWgsl({
  vsm: {
    pageTable: b.pageTable,
    projectionData: b.projectionData,
    uniforms: b.shadowUniforms,
    pool: b.pool,
  },
  trace: { view: b.shadowView, noise: 0 },
  quality: 0,
  localShadows: true,
  kinds: VSM_TRACE_KINDS_BOTH,
})

/** The light functions the injected lights wear, read at the cell's point. */
const LIGHT_FUNCTION = lightFunctionReadWgsl({
  group: 0,
  atlas: b.lightFunction,
  eye: 'tv.eye.xyz',
})

/** The clouds' shade of the air's lights, read at the cell's point. */
const CLOUD_SHADOW = cloudShadowReadWgsl({
  group: 0,
  block: b.cloudShadow,
  map0: b.cloudShadowMap0,
  map1: b.cloudShadowMap1,
  sampler: b.cloudShadowSampler,
})

/**
 * THE LIGHT EACH CELL OF THE VOLUME RECEIVES, one thread a cell of either cascade (`injectMain`, the cascades stacked
 * along the depth): the light of every light of its cascade's list, summed into the two-band harmonic
 * the volume holds (`TV_SH_WGSL`), written multiplied by the image's pre-exposure.
 *
 * A light's share at a cell is the one the surfaces take of the light at a point, the same terms in the same order:
 * its range, the cone of a spot and the face of a rectangle (`lightReaches`, whose first test is the sphere of
 * its reach); the point the light is read at — the cell's centre, moved half a cell away from the light, so that no
 * cell lies at the light's own centre and takes an overblown share —; the lamp's falloff there (`volumeLamp`: a
 * point's inverse square taken a square centimetre further, a rectangle's form factor with no normal, the cone and
 * the window of its range); its colour times its intensity over π; its light function (a colour for a local light, one
 * grey for the sun) and the shadow of its virtual shadow map, one sample at the point (`shadowFactor`); for the sun, the
 * clouds' shade and the air's transmittance toward it (`cloudShadowOnSurface`, `airTintOf`).
 *
 * The outer cascade fades at its border (`tvBorder`): a local light's falloff and shadow go to zero, the sun's shadow
 * to none, so that the border cells hold what lights every surface beyond both cascades, the sun unshadowed and no
 * local light. The harmonic of a light is its colour in the constant band and, in the three linear ones, its
 * luminance times the direction toward it (`TV_SH_WGSL`); the ambient texture's alpha sums, for the sun, the share
 * of its light that reached the cell, the attenuation times the shadow.
 */
const INJECT_WGSL = wgslBlock(
  'INJECT_WGSL',
  [
    TV_FRAME_WGSL,
    TV_SH_WGSL,
    TV_TEXEL_WGSL,
    INVERSE_PI,
    luminance,
    VOLUME_LAMP_WGSL,
    AIR_TINT_WGSL,
  ],
  `
/** What one light adds at the cell's point \`P\` of \`cascade\`: its colour through the harmonic into \`ambient\` and
 *  \`directional\`. */
fn tvInject(rank:u32,cascade:u32,P:vec3f,border:f32,ambient:ptr<function,vec4f>,directional:ptr<function,vec3f>){
 if(!lightReaches(rank,P)){return;}
 let light=directLights.items[rank];
 let sun=isSun(light);
 var L=-light.directionCone.xyz;
 if(!sun){L=normalize(light.positionRange.xyz-P);}
 // Half a cell away from the light, so that the light's own cell takes no overblown share.
 let lit=P-L*(0.5*tv.scale[cascade].w);
 var attenuation=1.0;
 if(!sun){attenuation=volumeLamp(light,lit,LAMP_BIAS).w;}
 if(attenuation<=0.0){return;}
 var shade=shadowFactor(i32(light.params.y),light,lit,vec3f(0.0),true);
 var colour=light.colorIntensity.rgb*(light.colorIntensity.w*INVERSE_PI);
 if(sun){
  shade*=dot(lightFunctionOf(light.params.x,lit),vec3f(0.3333))*cloudShadowOnSurface(rank,lit);
  if(cascade==1u){shade=mix(1.0,shade,border);}
  colour*=airTintOf(rank,light,lit);
 }else{
  if(cascade==1u){attenuation*=border;shade*=border;}
  colour*=lightFunctionOf(light.params.x,lit);
 }
 let share=attenuation*shade;
 colour*=share;
 let basis=tvBasis(L);
 *ambient+=vec4f(colour*basis.x,select(0.0,share,sun));
 *directional+=basis.yzw*luminance(colour);
}
@compute @workgroup_size(${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP},${TRANSLUCENCY_WORKGROUP})
fn injectMain(@builtin(global_invocation_id) id:vec3u){
 let dim=tv.mode.x;
 if(id.x>=dim||id.y>=dim||id.z>=dim*2u){return;}
 let cascade=id.z/dim;
 let cell=vec3f(vec3u(id.x,id.y,id.z%dim));
 let P=tvCellPoint(cascade,cell);
 let border=select(1.0,tvBorder(cascade,(cell+vec3f(0.5))/f32(dim)),cascade==1u);
 var ambient=vec4f(0.0);
 var directional=vec3f(0.0);
 let first=tv.lists[cascade*2u];
 let count=tv.lists[cascade*2u+1u];
 for(var i=0u;i<count;i++){tvInject(tvRanks[first+i],cascade,P,border,&ambient,&directional);}
 // The light is written multiplied by the image's pre-exposure; the alpha, a share, is not.
 let slice=id.z%dim;
 textureStore(tvInjected,vec3u(id.xy,slice+tvSlab(cascade,0u)*dim),vec4f(ambient.rgb*tv.weights.x,ambient.a));
 textureStore(tvInjected,vec3u(id.xy,slice+tvSlab(cascade,1u)*dim),vec4f(directional*tv.weights.x,0.0));
}`,
)

/** The injection's program. */
export const INJECT_PROGRAM = wgslProgram(
  `@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${b.frame}) var<uniform> tv:TranslucencyFrame;
@group(0) @binding(${b.ranks}) var<storage,read> tvRanks:array<u32>;
@group(0) @binding(${b.injected}) var tvInjected:texture_storage_3d<${VOLUME_FORMAT},write>;
`,
  [DIRECT_LIGHT_WGSL, SHADOW, LIGHT_FUNCTION, CLOUD_SHADOW, INJECT_WGSL],
)
