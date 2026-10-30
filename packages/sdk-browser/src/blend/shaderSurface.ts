import {
  FLAG_DIAGNOSTIC_VIEW,
  FLAG_DOUBLE,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_LIT,
  FLAG_SAMPLED,
  FLAG_UNLIT_VIEW,
} from '../visibility/types.ts'
import { ORM_LAW_WGSL } from '../lighting/ormWgsl.ts'
import { NORMAL_CURVATURE_FLAG_MASK } from '../materials/surface/surfaceModelWord.ts'
import { shadingNumberOfModel } from '../materials/surface/shadingModelCode.ts'
import { shadingFlagsOfNumber } from '../materials/surface/pixelModel.ts'
import { COTANGENT_FRAME_WGSL } from '../geometry/cluster/cotangentFrameWgsl.ts'
import { FACING_SHIFT, FACING_WGSL } from './facing.ts'
import { TRI_CHANNELS_BITS, TRI_CHANNELS_SHIFT, WORDS, materialFlagOf } from './vertexReadsWgsl.ts'
import { blendRequestWgsl } from './requestWgsl.ts'
import { BLEND_TANGENT_FRAME_WGSL } from './tangentFrameWgsl.ts'
import { COLOR_SAMPLE_WGSL, DATA_SAMPLE_WGSL } from '../materials/virtual/wgsl.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'
import { unitToSigned3 } from '../../../math/src/wgsl/reals.ts'
import { bitIsSet } from '../../../math/src/wgsl/integer.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { WRAP_MAP } from '../visibility/wrapModes.ts'
import { SUBSURFACE_MAP_BIT } from '../visibility/materialType.ts'
import { GRAPH_SHADING_MODELS } from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { GRAPH_FLAG, type BlendGraphs } from './graphWgsl.ts'

/** Whether a blend of item flags `flags` is lit by a lit view: its material lit, the view neither
 *  unlit nor a diagnostic. The one rule of the blend fragment's lighting and of the front stage's
 *  reflecting surface (`frontReflects`): the front writes a reflecting surface exactly where the
 *  blend fragment reads the front's radiance. */
export const blendLit = wgslFn(
  'blendLit',
  [],
  `fn blendLit(flags:u32)->bool{return (flags&${FLAG_LIT}u)!=0u&&(flags&${FLAG_UNLIT_VIEW | FLAG_DIAGNOSTIC_VIEW}u)==0u;}`,
)

/** The flags a blended item carries to its fragments from its record's model word `model`: the unlit shading model clears the lit flag
 *  (no light, no bounce, no reflection), and any other shading model leaves its pixel model number in the bits above the first-person mark
 *  (`pixelModelOf`), where the reflection reads the hair. */
export const blendShadingFlags = wgslFn(
  'blendShadingFlags',
  [shadingNumberOfModel, shadingFlagsOfNumber],
  'fn blendShadingFlags(flags:u32,model:u32)->u32{return shadingFlagsOfNumber(flags,shadingNumberOfModel(model));}',
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

/** The normal a graph wires, in tangent space, bends the normal of a fragment as a normal map does, in
 *  the frame the maps' own is (`blendSurface`). */
const GRAPH_NORMAL = ` if((g.graph.flags&${GRAPH_FLAG.normal}u)!=0u){
  let c=blendUv(in,g,${WRAP_MAP.base}u);
  let frame=cotangentFrame(N,g.q0,g.q1,c.ddx,c.ddy);
  var T=-frame.T;var B=-frame.B;
  if((flags&${FLAG_HAS_TANGENT}u)!=0u){let stored=blendTangentFrame(in);T=stored.T;B=stored.B;}
  let flip=select(1.0,face,(flags&${FLAG_DOUBLE | FLAG_HAS_NORMAL}u)==${FLAG_DOUBLE | FLAG_HAS_NORMAL}u);
  N=bendNormal(N,T,B,flip,g.graph.normal);
 }
`

/** The first UV set: the whole of a lobeless program's `uv`, a lobed one's first two lanes. */
const FIRST_UV = 'in.uv.xy'

/** The screen-derivative record of a fragment and its readers (`blendGrads`, `blendSampled`); the normal's derivatives are those of the
 *  unit vector (`unitNormal`), the opaque resolve's own. */
const blendGradsText = (
  lobes: boolean,
  graphs?: BlendGraphs,
) => `struct BlendGrads{gradX:vec2f,gradY:vec2f,q0:vec3f,q1:vec3f,nX:vec3f,nY:vec3f,${lobes ? 'uv1X:vec2f,uv1Y:vec2f,channels:u32,' : ''}${graphs ? 'graph:BlendGraph,' : ''}}
fn blendGrads(in:VSOut)->BlendGrads{let unitNormal=unitOrZero(in.normal.xyz);return BlendGrads(dpdx(${FIRST_UV}),dpdy(${FIRST_UV}),dpdx(in.view),dpdy(in.view),dpdx(unitNormal),dpdy(unitNormal)${lobes ? `,dpdx(in.uv.zw),dpdy(in.uv.zw),extractBits(in.${WORDS.tri},${TRI_CHANNELS_SHIFT}u,${TRI_CHANNELS_BITS}u)` : ''}${graphs ? ',blendGraphEval(in)' : ''});}
fn blendSampled(in:VSOut)->bool{return (in.ids.y&${FLAG_SAMPLED}u)!=0u;}
`

/** The map coordinate and derivatives a map is read at (`blendUv`). */
const blendUvText = (
  lobes: boolean,
) => `/** The coordinate and screen derivatives map \`i\` (\`SURFACE_MAP_FIELDS\` order) is read at: the
 *  set past the first where the record's \`channels\` word says it reads one, in a program that
 *  carries it (\`channelsRead\`). */
struct BlendUv{uv:vec2f,ddx:vec2f,ddy:vec2f,}
fn blendUv(in:VSOut,g:BlendGrads,i:u32)->BlendUv{
 ${lobes ? 'if(bitIsSet(g.channels,i)){return BlendUv(in.uv.zw,g.uv1X,g.uv1Y);}' : ''}
 return BlendUv(${FIRST_UV},g.gradX,g.gradY);
}
`

/** The base sample, its opacity and the coverage test, and the graph's tile request. */
const blendBaseText = (
  graphs?: BlendGraphs,
) => `/** The base map's sample: the colour, and the alpha the coverage test reads. */
fn blendBase(in:VSOut,g:BlendGrads)->vec4f{${graphs ? 'if(g.graph.id!=0u){return vec4f(g.graph.rgb,g.graph.opacity);}' : ''}let c=blendUv(in,g,${WRAP_MAP.base}u);return colorSample(in.ids.x,c.uv,c.ddx,c.ddy,blendSampled(in));}
/** The fragment's opacity: what the alpha test compares and the stage writes. */
fn blendAlpha(in:VSOut,base:vec4f)->f32{return base.w*in.color.w;}
fn blendKeeps(in:VSOut,base:vec4f,front:bool)->bool{
 return !(blendAlpha(in,base)<in.alphaAo.x||facingDiscarded(in.${WORDS.material}>>${FACING_SHIFT}u,front));
}
${graphs ? "/** The tile the fragment asks: its graph's where the item wears one, else its maps'. */\nfn blendRequestOf(in:VSOut,g:BlendGrads)->u32{if(g.graph.id!=0u){return g.graph.request;}return blendRequest(in,g);}\n" : ''}`

/** The normal-map block of `blendSurface`: the map bent in the cotangent frame. */
const BLEND_NORMAL_MAP_TEXT = ` if(in.maps.z!=0u){
  let c=blendUv(in,g,${WRAP_MAP.normal}u);
  let scale=vec3f(in.pbr.z,in.pbr.w,1.0);
  let mapN=unitToSigned3(dataSample(in.maps.z,c.uv,c.ddx,c.ddy,sampled).xyz)*scale;
  // The frame of the opaque resolve, on screen derivatives of the map's own UV set: framebuffer y
  // runs down, hence the sign, as on the geometric normal above.
  let frame=cotangentFrame(N,g.q0,g.q1,c.ddx,c.ddy);
  var T=-frame.T;var B=-frame.B;
  if((flags&${FLAG_HAS_TANGENT}u)!=0u){let stored=blendTangentFrame(in);T=stored.T;B=stored.B;}
  let flip=select(1.0,face,(flags&${FLAG_DOUBLE | FLAG_HAS_NORMAL}u)==${FLAG_DOUBLE | FLAG_HAS_NORMAL}u);
  N=bendNormal(N,T,B,flip,mapN);
 }
`

/** An unlit pixel of a graph shows its held emission alone (`blendGraph`: `g.graph.rgb`), neither tinted by the item's colour nor the
 *  vertex's: the shading model's rule, not the base colour's. */
const UNLIT_GRAPH_RGB = ` if(g.graph.id!=0u&&(g.graph.flags&${GRAPH_FLAG.model}u)!=0u&&g.graph.model==${GRAPH_SHADING_MODELS.unlit}){rgb=g.graph.rgb;}
`

/** The `BlendSurface` record and the start of `blendSurface`, up to the normal map. */
const blendSurfaceHeadText = (
  graphs?: BlendGraphs,
) => `struct BlendSurface{rgb:vec3f,alpha:f32,N:vec3f,rough:f32,metal:f32,ao:f32,emissive:vec3f,request:u32,subsurface:vec3f,geometric:vec3f,curvature:f32,${graphs ? 'specular:f32,' : ''}}
fn blendSurface(in:VSOut,front:bool,g:BlendGrads,base:vec4f)->BlendSurface{
 let flags=in.ids.y;
 let sampled=blendSampled(in);
 let request=${graphs ? 'blendRequestOf' : 'blendRequest'}(in,g);
 let geometric=blendGeometricNormal(in,front,g.q0,g.q1);
 var N=geometric;
 let face=select(-1.0,1.0,front);
 // A sky surface is opaque wherever it is kept: its cutout (blendKeeps) reads the base alpha, the layer it writes does not.
 let alpha=select(blendAlpha(in,base),1.0,${materialFlagOf('sky')});
 ${graphs?.model ? 'var' : 'let'} rgb=in.color.xyz*base.xyz;
${graphs?.model ? UNLIT_GRAPH_RGB : ''} var roughTexel=1.0;var metalTexel=1.0;var aoTexel=1.0;
 if(in.maps.x!=0u){let c=blendUv(in,g,${WRAP_MAP.rough}u);roughTexel=dataSample(in.maps.x,c.uv,c.ddx,c.ddy,sampled).g;}
 if(in.maps.y!=0u){let c=blendUv(in,g,${WRAP_MAP.metal}u);metalTexel=dataSample(in.maps.y,c.uv,c.ddx,c.ddy,sampled).b;}
 if(in.maps.w!=0u){let c=blendUv(in,g,${WRAP_MAP.ao}u);aoTexel=dataSample(in.maps.w,c.uv,c.ddx,c.ddy,sampled).r;}
${graphs ? ' if(g.graph.id!=0u){roughTexel=g.graph.rough;metalTexel=g.graph.metal;aoTexel=g.graph.ao;}\n' : ''} var rough=ormRoughness(in.pbr.x,roughTexel);let metal=ormMetalness(in.pbr.y,metalTexel);let ao=ormOcclusion(in.alphaAo.y,aoTexel);
`

/** The rest of `blendSurface` after the normal map: roughness, emission, subsurface, the record. */
const blendSurfaceTailText = (
  lobes: boolean,
  graphs?: BlendGraphs,
) => `${graphs ? GRAPH_NORMAL : ''} var curvature=0.0;
 if((flags&${NORMAL_CURVATURE_FLAG_MASK}u)!=0u){let curved=normalCurvatureApply(rough,g.nX,g.nY,uni.normalCurvature);rough=curved.x;curvature=curved.y;}
 var emissive=in.emissive.xyz;
 if(in.ids.z!=0u){let c=blendUv(in,g,${WRAP_MAP.emissive}u);emissive*=colorSample(in.ids.z,c.uv,c.ddx,c.ddy,sampled).rgb;}
${graphs ? ' if(g.graph.id!=0u){emissive=g.graph.emissive;}\n' : ''} var thin=clamp(vec3f(in.normal.w,in.tangent.w,in.bitangent.w),vec3f(0.0),vec3f(1.0));
 if(in.emissive.w!=0.0){let c=blendUv(in,g,${SUBSURFACE_MAP_BIT}u);thin*=colorSample(u32(in.emissive.w),c.uv,c.ddx,c.ddy,sampled).rgb;}
${graphs ? ` if((g.graph.flags&${GRAPH_FLAG.thin}u)!=0u){thin=g.graph.thin;}\n` : ''} let surface=BlendSurface(rgb,alpha,N,rough,metal,ao,emissive,request,thin,geometric,curvature${graphs ? ',select(0.5,g.graph.specular,g.graph.id!=0u)' : ''});
 return ${lobes ? 'blendLobesRead(in,front,g,surface)' : 'surface'};
}
`

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
 * With `lobes`, a lobed program's (`vertexWgsl.ts`): its screen derivatives take the one set past
 * the first it carries too (`physicalWgsl.ts`), and each map that reads a set past the first is
 * read at it (`blendUv`, the `channels` word, glTF's `texCoord`); a lobeless program carries the
 * first alone. `geometric` is the normal before the map, which the coat bends its own map from.
 * The thin subsurface colour before its map is the lanes the vertex stage writes it in
 * (`normal.w`, `tangent.w`, `bitangent.w`). In a lobed program the fragment's lobes are read
 * with its surface, once (`blendLobesRead`, `physicalWgsl.ts`).
 */
export const blendSurfaceWgsl = (lobes: boolean, graphs?: BlendGraphs) => {
  return wgslBlock(
    `blendSurfaceWgsl(${lobes}${graphs ? `, ${graphs.key}` : ''})`,
    [
      unitOrZero,
      unitToSigned3,
      ORM_LAW_WGSL,
      COTANGENT_FRAME_WGSL,
      BLEND_TANGENT_FRAME_WGSL,
      BLEND_SURFACE_NORMAL_WGSL,
      COLOR_SAMPLE_WGSL,
      DATA_SAMPLE_WGSL,
      FACING_WGSL,
      blendRequestWgsl(lobes),
      bitIsSet,
      ...(lobes || graphs ? [materialTableWgsl(BLEND_BINDINGS.material)] : []),
      ...(graphs ? [graphs.decl] : []),
    ],
    `
${blendGradsText(lobes, graphs)}${blendUvText(lobes)}${blendBaseText(graphs)}${blendSurfaceHeadText(graphs)}${BLEND_NORMAL_MAP_TEXT}${blendSurfaceTailText(lobes, graphs)}`,
  )
}
