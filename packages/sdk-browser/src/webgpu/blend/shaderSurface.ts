import { FLAG_DOUBLE, FLAG_HAS_NORMAL, FLAG_SAMPLED } from '../../visibility/types.ts'
import { COTANGENT_FRAME_WGSL } from '../../cluster/decodeWgsl.ts'
import { FACING_SHIFT, FACING_WGSL } from './facing.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL } from '../tile/wgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'

/** The pixel's footprint at lit point \`P\`, in metres: what the blend's shadow reads at
 *  (\`shadowFootprint\`). */
const BLEND_SHADOW_FOOTPRINT_WGSL = wgslBlock(
  'BLEND_SHADOW_FOOTPRINT_WGSL',
  [],
  `fn blendShadowFootprint(P:vec3f)->f32{return select(uni.pixelScale,uni.pixelScale*length(uni.camPos.xyz-P),uni.camPos.w!=0.0);}`,
)

const BLEND_SURFACE_NORMAL_WGSL = wgslBlock(
  'BLEND_SURFACE_NORMAL_WGSL',
  [unitOrZero],
  `/** The normal before any normal map: the vertex attribute, turned on the back of a two-sided
 *  material, or the face's own from screen derivatives \`q0\`, \`q1\` of the point: what the blend
 *  stage bends by its map (\`blendSurface\`). */
fn blendGeometricNormal(in:VSOut,front:bool,q0:vec3f,q1:vec3f)->vec3f{
 // unitOrZero yields normalize wherever the vector is not null: same bits as before on an
 // ordinary surface, a null vector — and not NaN — on a collapsed face, whose a NaN would win
 // neighbouring pixels through screen derivatives. A rank-2 pose does not arrive there null:
 // xformNormal already gave it the flattened face's normal.
 // The geometric normal comes from screen derivatives: it already looks at the observer, whatever
 // the rasterised face. Only a vertex normal, which points toward the declared outside, flips on
 // the back of a two-sided material — flipping it too would send the geometric one opposite the
 // light, and the surface would render exactly zero. Same rule as the opaque resolve, which only
 // flips the interpolated normal.
 let flags=in.ids.y;
 var N=unitOrZero(-cross(q0,q1));
 if((flags&${FLAG_HAS_NORMAL}u)!=0u){
  N=unitOrZero(in.normal.xyz);
  let face=select(-1.0,1.0,front);
  if((flags&${FLAG_DOUBLE}u)!=0u){N*=face;}
 }
 return N;
}`,
)

/**
 * What a transparent fragment reads on its material, before any lighting: base colour and
 * opacity, the normal — from the vertex attribute, from screen derivatives, then bent by the
 * normal map in the cotangent frame the opaque resolve uses —, roughness, metalness, occlusion,
 * emission, and the tile rank the pixel asks of the virtual textures.
 *
 * Two fragment stages consume it, and it is the only place the material is read: the blend
 * stage, which lights it in place (`shader.ts`), and the water surface stage, which
 * stores it for the fullscreen composite (`../water/surfaceWgsl.ts`). The host shader
 * declares `VSOut` and the atlas bindings.
 *
 * Each stage reads it in three steps: the screen derivatives (`blendGrads`), in uniform control
 * flow; the base sample and the coverage test (`blendKeeps`) — the alpha test, and the side a
 * doubtful triangle does not draw (`facing.ts`) —, where a rejected fragment discards and RETURNS;
 * then the rest of the material (`blendSurface`). A `discard` alone only demotes the invocation to
 * a helper, which a backend runs to the end: returning is what spares a rejected fragment every
 * other read and its lighting. Every derivative is taken before that return, so a helper lane's
 * neighbours read the same ones; every value a kept fragment computes is the one it computed
 * before, from the same operands.
 *
 * With `lobes`, a lobed program's (`vertexWgsl.ts`): its screen derivatives take the second UV
 * set's too (`physicalWgsl.ts`). `geometric` is the normal before the map, which the coat bends
 * its own map from.
 */
export const blendSurfaceWgsl = (lobes: boolean) => {
  // The first UV set: the whole of a lobeless program's \`uv\`, a lobed one's first two lanes.
  const uv = 'in.uv.xy'
  return wgslBlock(
    `blendSurfaceWgsl(${lobes})`,
    [
      unitOrZero,
      unitToSigned3,
      COTANGENT_FRAME_WGSL,
      BLEND_SURFACE_NORMAL_WGSL,
      BLEND_SHADOW_FOOTPRINT_WGSL,
      COLOR_SAMPLE_WGSL,
      DATA_SAMPLE_WGSL,
      FACING_WGSL,
      blendRequestWgsl(lobes),
    ],
    `
struct BlendGrads{gradX:vec2f,gradY:vec2f,q0:vec3f,q1:vec3f,${lobes ? 'uv1X:vec2f,uv1Y:vec2f,' : ''}}
fn blendGrads(in:VSOut)->BlendGrads{return BlendGrads(dpdx(${uv}),dpdy(${uv}),dpdx(in.view),dpdy(in.view)${lobes ? ',dpdx(in.uv.zw),dpdy(in.uv.zw)' : ''});}
fn blendSampled(in:VSOut)->bool{return (in.ids.y&${FLAG_SAMPLED}u)!=0u;}
/** The base map's sample: the colour, and the alpha the coverage test reads. */
fn blendBase(in:VSOut,g:BlendGrads)->vec4f{return colorSample(in.ids.x,${uv},g.gradX,g.gradY,blendSampled(in));}
/** The fragment's opacity: what the alpha test compares and the stage writes. */
fn blendAlpha(in:VSOut,base:vec4f)->f32{return base.w*in.color.w;}
fn blendKeeps(in:VSOut,base:vec4f,front:bool)->bool{
 return !(blendAlpha(in,base)<in.alphaAo.x||facingDiscarded(in.water>>${FACING_SHIFT}u,front));
}
struct BlendSurface{rgb:vec3f,alpha:f32,N:vec3f,rough:f32,metal:f32,ao:f32,emissive:vec3f,request:u32,subsurface:vec3f,geometric:vec3f,}
fn blendSurface(in:VSOut,front:bool,g:BlendGrads,base:vec4f)->BlendSurface{
 let flags=in.ids.y;
 let sampled=blendSampled(in);
 let gradX=g.gradX;let gradY=g.gradY;
 let request=blendRequest(in,gradX,gradY);
 let geometric=blendGeometricNormal(in,front,g.q0,g.q1);
 var N=geometric;
 let face=select(-1.0,1.0,front);
 let alpha=blendAlpha(in,base);
 let rgb=in.color.xyz*base.xyz;
 var rough=in.pbr.x;var metal=in.pbr.y;var ao=1.0;
 if(in.maps.x!=0u){rough*=dataSample(in.maps.x,${uv},gradX,gradY,sampled).g;}
 if(in.maps.y!=0u){metal*=dataSample(in.maps.y,${uv},gradX,gradY,sampled).b;}
 if(in.maps.w!=0u){ao+=in.alphaAo.y*(dataSample(in.maps.w,${uv},gradX,gradY,sampled).r-1.0);}
 if(in.maps.z!=0u){
  let mapN=unitToSigned3(dataSample(in.maps.z,${uv},gradX,gradY,sampled).xyz);
  // The frame of the opaque resolve, on screen derivatives: framebuffer y runs down, hence the
  // sign, as on the geometric normal above.
  let frame=cotangentFrame(N,g.q0,g.q1,gradX,gradY);
  var T=-frame.T;var B=-frame.B;
  if((flags&2048u)!=0u){T=unitOrZero(in.tangent.xyz);B=unitOrZero(in.bitangent.xyz);}
  if((flags&2u)!=0u&&(flags&16u)!=0u){T*=face;B*=face;}
  N=unitOrZero(T*mapN.x*in.pbr.z+B*mapN.y*in.pbr.w+N*mapN.z);
 }
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){emissive*=colorSample(in.ids.z,${uv},gradX,gradY,sampled).rgb;}
 var thin=clamp(vec3f(in.normal.w,in.tangent.w,in.bitangent.w),vec3f(0.0),vec3f(1.0));
 if(in.emissive.w!=0.0){thin*=colorSample(u32(in.emissive.w),${uv},gradX,gradY,sampled).rgb;}
 return BlendSurface(rgb,alpha,N,rough,metal,ao,emissive,request,thin,geometric);
}
`,
  )
}
