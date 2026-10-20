import {
  FLAG_DIAGNOSTIC_VIEW,
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_SAMPLED,
  FLAG_UNLIT_VIEW,
} from '../../visibility/types.ts'
import { ORM_LAW_WGSL } from '../../lighting/ormWgsl.ts'
import { COTANGENT_FRAME_WGSL } from '../../cluster/cotangentFrameWgsl.ts'
import { FACING_SHIFT, FACING_WGSL } from './facing.ts'
import { TRI_CHANNELS_SHIFT } from './vertexReadsWgsl.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL } from '../tile/wgsl.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'
import { bitIsSet } from '../../../../math/src/wgsl/integer.ts'
import { materialTableWgsl } from '../material/materialWgsl.ts'
import { BLEND_BINDINGS } from '../core/bindLayout.ts'
import { WRAP_MAP } from '../../visibility/wrapModes.ts'
import { SUBSURFACE_MAP_BIT } from '../../visibility/materialType.ts'

/** Whether a blend of item flags `flags` is lit by a lit view: its material lit, the view neither
 *  unlit nor a diagnostic. The one rule of the blend fragment's lighting and of the front stage's
 *  reflecting surface (`frontReflects`): the front writes a reflecting surface exactly where the
 *  blend fragment reads the front's radiance. */
export const blendLit = wgslFn(
  'blendLit',
  [],
  `fn blendLit(flags:u32)->bool{return (flags&${FLAG_LIT}u)!=0u&&(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)==0u;}`,
)

/** The unit direction from a blend fragment to the eye — a directional view's along its axis
 *  (`uni.camPos.w` zero) —, read the one way by the blend stages and the transmissive layers. */
export const BLEND_TO_EYE_WGSL = wgslBlock(
  'BLEND_TO_EYE_WGSL',
  [],
  `fn blendToEye(in:VSOut)->vec3f{return normalize(uni.camPos.xyz-in.view*uni.camPos.w);}`,
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
 * Every fragment stage of the runs consumes it, and it is the only place the material is read: the
 * blend stage, which lights it in place (`shader.ts`), the transmissive ones
 * (`./transmission/transmitWgsl.ts`) and the front stage. The host shader declares `VSOut` and the
 * atlas bindings.
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
 * set's too (`physicalWgsl.ts`), and each map is read at the set its record names (`blendUv`, the
 * `channels` word, glTF's `texCoord`); a lobeless program carries the first alone. `geometric` is
 * the normal before the map, which the coat bends its own map from.
 */
export const blendSurfaceWgsl = (lobes: boolean) => {
  // The first UV set: the whole of a lobeless program's \`uv\`, a lobed one's first two lanes.
  const uv = 'in.uv.xy'
  return wgslBlock(
    `blendSurfaceWgsl(${lobes})`,
    [
      unitOrZero,
      unitToSigned3,
      ORM_LAW_WGSL,
      COTANGENT_FRAME_WGSL,
      BLEND_SURFACE_NORMAL_WGSL,
      COLOR_SAMPLE_WGSL,
      DATA_SAMPLE_WGSL,
      FACING_WGSL,
      blendRequestWgsl(lobes),
      bitIsSet,
      ...(lobes ? [materialTableWgsl(BLEND_BINDINGS.material)] : []),
    ],
    `
struct BlendGrads{gradX:vec2f,gradY:vec2f,q0:vec3f,q1:vec3f,nX:vec3f,nY:vec3f,${lobes ? 'uv1X:vec2f,uv1Y:vec2f,channels:u32,' : ''}}
fn blendGrads(in:VSOut)->BlendGrads{return BlendGrads(dpdx(${uv}),dpdy(${uv}),dpdx(in.view),dpdy(in.view),dpdx(in.normal.xyz),dpdy(in.normal.xyz)${lobes ? `,dpdx(in.uv.zw),dpdy(in.uv.zw),in.tri>>${TRI_CHANNELS_SHIFT}u` : ''});}
fn blendSampled(in:VSOut)->bool{return (in.ids.y&${FLAG_SAMPLED}u)!=0u;}
/** The coordinate and screen derivatives map \`i\` (\`SURFACE_MAP_FIELDS\` order) is read at: the
 *  second UV set where the record's \`channels\` word says so, in a program that carries it. */
struct BlendUv{uv:vec2f,ddx:vec2f,ddy:vec2f,}
fn blendUv(in:VSOut,g:BlendGrads,i:u32)->BlendUv{
 ${lobes ? 'if(bitIsSet(g.channels,i)){return BlendUv(in.uv.zw,g.uv1X,g.uv1Y);}' : ''}
 return BlendUv(${uv},g.gradX,g.gradY);
}
/** The base map's sample: the colour, and the alpha the coverage test reads. */
fn blendBase(in:VSOut,g:BlendGrads)->vec4f{let c=blendUv(in,g,${WRAP_MAP.base}u);return colorSample(in.ids.x,c.uv,c.ddx,c.ddy,blendSampled(in));}
/** The fragment's opacity: what the alpha test compares and the stage writes. */
fn blendAlpha(in:VSOut,base:vec4f)->f32{return base.w*in.color.w;}
fn blendKeeps(in:VSOut,base:vec4f,front:bool)->bool{
 return !(blendAlpha(in,base)<in.alphaAo.x||facingDiscarded(in.material>>${FACING_SHIFT}u,front));
}
struct BlendSurface{rgb:vec3f,alpha:f32,N:vec3f,rough:f32,metal:f32,ao:f32,emissive:vec3f,request:u32,subsurface:vec3f,geometric:vec3f,}
fn blendSurface(in:VSOut,front:bool,g:BlendGrads,base:vec4f)->BlendSurface{
 let flags=in.ids.y;
 let sampled=blendSampled(in);
 let request=blendRequest(in,g);
 let geometric=blendGeometricNormal(in,front,g.q0,g.q1);
 var N=geometric;
 let face=select(-1.0,1.0,front);
 // The shading normal one pixel right (\`Nx\`) and one down (\`Ny\`): the vertex normal's change
 // across the pixel, which widens the roughness (\`normalFootprintVariance\`); a flat face's none.
 var Nx=N;var Ny=N;
 if((flags&${FLAG_HAS_NORMAL}u)!=0u){
  let side=select(1.0,face,(flags&${FLAG_DOUBLE}u)!=0u);
  Nx=unitOrZero(in.normal.xyz+g.nX)*side;Ny=unitOrZero(in.normal.xyz+g.nY)*side;
 }
 let alpha=blendAlpha(in,base);
 let rgb=in.color.xyz*base.xyz;
 var roughTexel=1.0;var metalTexel=1.0;var aoTexel=1.0;
 if(in.maps.x!=0u){let c=blendUv(in,g,${WRAP_MAP.rough}u);roughTexel=dataSample(in.maps.x,c.uv,c.ddx,c.ddy,sampled).g;}
 if(in.maps.y!=0u){let c=blendUv(in,g,${WRAP_MAP.metal}u);metalTexel=dataSample(in.maps.y,c.uv,c.ddx,c.ddy,sampled).b;}
 if(in.maps.w!=0u){let c=blendUv(in,g,${WRAP_MAP.ao}u);aoTexel=dataSample(in.maps.w,c.uv,c.ddx,c.ddy,sampled).r;}
 var rough=ormRoughness(in.pbr.x,roughTexel);let metal=ormMetalness(in.pbr.y,metalTexel);let ao=ormOcclusion(in.alphaAo.y,aoTexel);
 if(in.maps.z!=0u){
  let c=blendUv(in,g,${WRAP_MAP.normal}u);
  let scale=vec3f(in.pbr.z,in.pbr.w,1.0);
  let mapN=unitToSigned3(dataSample(in.maps.z,c.uv,c.ddx,c.ddy,sampled).xyz)*scale;
  // The map one pixel right and one down, at the same level: its own change across the pixel.
  let mapNx=unitToSigned3(dataSample(in.maps.z,c.uv+c.ddx,c.ddx,c.ddy,sampled).xyz)*scale;
  let mapNy=unitToSigned3(dataSample(in.maps.z,c.uv+c.ddy,c.ddx,c.ddy,sampled).xyz)*scale;
  // The frame of the opaque resolve, on screen derivatives of the map's own UV set: framebuffer y
  // runs down, hence the sign, as on the geometric normal above.
  let frame=cotangentFrame(N,g.q0,g.q1,c.ddx,c.ddy);
  var T=-frame.T;var B=-frame.B;
  if((flags&${FLAG_HAS_TANGENT}u)!=0u){T=unitOrZero(in.tangent.xyz);B=unitOrZero(in.bitangent.xyz);}
  let flip=select(1.0,face,(flags&${FLAG_DOUBLE | FLAG_HAS_NORMAL}u)==${FLAG_DOUBLE | FLAG_HAS_NORMAL}u);
  N=bendNormal(N,T,B,flip,mapN);
  Nx=bendNormal(Nx,T,B,flip,mapNx);
  Ny=bendNormal(Ny,T,B,flip,mapNy);
 }
 rough=ormRoughness(1.0,roughnessWidened(rough,normalFootprintVariance(Nx-N,Ny-N)));
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){let c=blendUv(in,g,${WRAP_MAP.emissive}u);emissive*=colorSample(in.ids.z,c.uv,c.ddx,c.ddy,sampled).rgb;}
 var thin=clamp(vec3f(in.normal.w,in.tangent.w,in.bitangent.w),vec3f(0.0),vec3f(1.0));
 if(in.emissive.w!=0.0){let c=blendUv(in,g,${SUBSURFACE_MAP_BIT}u);thin*=colorSample(u32(in.emissive.w),c.uv,c.ddx,c.ddy,sampled).rgb;}
 return BlendSurface(rgb,alpha,N,rough,metal,ao,emissive,request,thin,geometric);
}
`,
  )
}
