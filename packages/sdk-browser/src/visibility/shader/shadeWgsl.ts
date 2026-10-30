import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { SHADE_DECL_WGSL, shadeDeclWgsl } from './shadeDeclWgsl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { edgeFunction } from '../../../../math/src/wgsl/barycentric.ts'
import { PIXEL_BARYCENTRIC_WGSL } from './pixelBarycentricWgsl.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { TILE_NOISE_WGSL } from '../../materials/texture/samplingFootprint.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { unitToSigned3 } from '../../../../math/src/wgsl/reals.ts'
import { cofactor3, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { VOXEL_HIT_WGSL } from './voxelHitWgsl.ts'
import { VOXEL_SURFACE_WGSL } from './voxelWgsl.ts'
import { VOXEL_STEPS_WGSL } from './voxelStepsWgsl.ts'
import { DIAGNOSTIC_VIEWS as V } from './shadeMode.ts'
import { DIAGNOSTIC_PALETTE_WGSL } from '../../diagnostic/colors.ts'
import { ORM_LAW_WGSL } from '../../lighting/ormWgsl.ts'
import { coordonnee, lecture, lectureDonnee, siCarte } from './maps.ts'
import { SUBSURFACE_MAP_BIT } from '../materialType.ts'
import {
  AS_IS_FLAG,
  MODEL_SHIFT,
  SURFACE_MODEL,
  UNLIT_FLAG,
  modelFlag,
  subsurfaceOpacityOfModel,
  subsurfaceProfileOfModel,
  normalCurvatureOfModel,
} from '../../materials/surface/surfaceModelWord.ts'
import {
  shadingModelOfModel,
  shadingUnlitOfModel,
} from '../../materials/surface/shadingModelCode.ts'
import {
  FOG_FREE_SURFACE_FLAG,
  HOLDOUT_SURFACE_FLAG,
  NORMAL_VIEW_COLOR_WGSL,
} from '../../materials/surface/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import {
  PIXEL_MODEL,
  pixelModelFlag,
  quantise8,
  quantise8x2,
} from '../../materials/surface/pixelModel.ts'
import { specularFlag } from '../../materials/surface/surfaceSpecular.ts'
import { materialModelStatements } from './materialModelWgsl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { EMISSIVE_AO_FLAG_WGSL } from '../../materials/surface/surfaceEmission.ts'
import { FLAG_BACK, FLAG_DISTANCE_FIELD, FLAG_FOG_FREE, FLAG_HOLDOUT, FLAG_LIT } from '../types.ts'
import { DISTANCE_FIELD_REPRESENTATION_FLAG } from '../../lighting/distanceField/representationWgsl.ts'
import { PHYSICAL_LOBES_CALL, physicalUvRead } from './physicalWgsl.ts'
import { SHADE_ENTRY_WGSL } from './shadeEntryWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'
import { DISPLACED_PIXEL_WGSL } from '../tessellation/prismWgsl.ts'
import type { CompiledGraph } from '../../materials/graph/compile.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from './wpoGraphWgsl.ts'
import { shadeGraph, type ShadeGraph } from './shadeGraphWgsl.ts'
import {
  DISPLACED_PIXEL,
  NEIGHBOUR_WEIGHTS,
  STORED_TANGENT_FRAME_WGSL,
  VOXEL_DIAGNOSTIC,
  VOXEL_NORMAL,
  VOXEL_PIXEL,
  VOXEL_SURFACE,
} from './shadeVariantsWgsl.ts'

/** What a module of the resolve is made with: whether it places its pixels on voxels or on displaced
 *  triangles, and the pieces its graph splices (`shadeGraphWgsl.ts`). */
export type ShadeOptions = {
  voxel: boolean
  displaced: boolean
  graph?: ShadeGraph
  /** The expression of the side of the surface a pixel is seen from (`screenFace`): the triangle's winding on the screen, unless the caller knows it (a hit of a ray). */
  screenFace?: string
}

/** The surface resolve's head: the triangle, the pixel's weights and its first texture coordinate. */
const SURFACE_HEAD = (
  o: ShadeOptions,
) => `/** The surface of a pixel of the class's bin (\`binnedPixel\`), its storage values in the variables of
 *  its entry (\`shadeEntryWgsl.ts\`), marked with its page's marks (\`withPageMarks\`); the surface itself
 *  (\`shadePageSurface\`) has its factors and maps from its record (\`materialAt\`). */
fn shadeSurface(pos:vec4f,id:u32)->SurfaceOut{
 // The level a one-read texture takes is moved by a noise of the pixel and the image
 // (\`tileNoise\`, \`samplingFootprint.ts\`).
 tileNoise=interleavedGradientNoise(pos.xy,f32(uni.frameIndex&7u));
 let pageIndex=visPageIndex(id);
 shadeSelectRow(pageIndex);
 let page=pages[pageIndex];
 return withPageMarks(shadePageSurface(page,pos,id),page.marks);
}
fn shadePageSurface(page:PageInfo,pos:vec4f,id:u32)->SurfaceOut{
 let tri=visTriangle(id);
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
 if(SHADE_STAGE==2u){let k=pageTriangle(page,pageHeader(page),tri);shadeProbe=k.x^k.y^k.z;return emptySurface();}
 let m=materialAt(page.material);
 // The triangle, decoded and transformed by the pixel (\`pixelTriangle\`).
 let t=pixelTriangle(page,tri);
 let w0=t.w0;let w1=t.w1;let w2=t.w2;
 // A corner's pixel in x and y, its clip depth and w: the parts of \`framebuffer(c)\` and of \`c\`
 // the resolve reads (\`decodeTriangle\`).
 let s0=t.p0.xyz;let s1=t.p1.xyz;let s2=t.p2.xyz;let c0=t.p0;let c1=t.p1;let c2=t.p2;
 let p=vec2f(pos.x,pos.y);
 let area=edgeFunction(s1.xy,s2.xy,s0.xy);
 if(SHADE_STAGE==3u){shadeProbe=bitcast<u32>(dot(t.p0+t.p1+t.p2+t.w0+t.w1+t.w2,vec4f(1.0))+dot(t.n0+t.n1+t.n2,vec3f(1.0))+select(0.0,dot(t.uva+t.uvb+t.uvc,vec2f(1.0)),HAS_UV)+dot(t.iw,vec3f(1.0)));return emptySurface();}
 var rgb=m.baseColor;
 // The pixel's weights and their steps one pixel right and down, solved once (\`pixelBarycentric\`).
 let pb=pixelBarycentric(s0,s1,s2,t.iw,p,area);
 ${o.displaced ? 'var' : 'let'} bary=pb.value;${o.displaced ? 'var' : 'let'} stepX=pb.dx;${o.displaced ? 'var' : 'let'} stepY=pb.dy;
${o.displaced ? DISPLACED_PIXEL : ''}${o.voxel ? VOXEL_PIXEL : ''} var uv=vec2f(0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if(HAS_UV){
  uv=t.uva*bary.x+t.uvb*bary.y+t.uvc*bary.z;
  let g=uvGradients(stepX,stepY,t.uva,t.uvb,t.uvc);
  ddx=g[0];ddy=g[1];
 }
`

/** The pixel's other texture sets, its tile request and the reads of its maps (a graph's context first). */
export const SURFACE_READS = (
  o: ShadeOptions,
) => ` if(SHADE_STAGE==4u){shadeProbe=bitcast<u32>(dot(bary,vec3f(1.0))+select(0.0,dot(uv+ddx+ddy,vec2f(1.0)),HAS_UV)+dot(rgb,vec3f(1.0))+area);return emptySurface();}
 let model=(page.flags>>${MODEL_SHIFT}u)&7u;
 // A matcap material reads its image by the view-space normal: the base map at that coordinate,
 // from the triangle's world normals the decode turned to the row's side (\`decodeTriangle\`).
 if(MATCAP&&model==${SURFACE_MODEL.matcap}u){
  uv=matcapUv(unitOrZero(t.n0*bary.x+t.n1*bary.y+t.n2*bary.z));
  ddx=vec2f(0.0);ddy=vec2f(0.0);
 }
 // The pixel's UV sets and its anisotropic and clear-coat record, which the tile request reads too.
 ${physicalUvRead(o.graph?.sets)}
${o.graph?.prologue ?? ''} let request=shadeRequest(m,pos.xy);
 var roughSample=vec4f(1.0);
 ${siCarte('rough', `roughSample=${lecture('dataSample', 'rough')};`)}
 var metalSample=vec4f(1.0);
 ${lectureDonnee('metalSample', 'metal', [['roughSample', 'rough']])}
 var aoSample=vec4f(1.0);
 ${lectureDonnee('aoSample', 'ao', [
   ['roughSample', 'rough'],
   ['metalSample', 'metal'],
 ])}
 var ao=ormOcclusion(m.aoIntensity,aoSample.r);
 var emissive=m.emissive;
 ${siCarte('emissive', `emissive*=${lecture('colorSample', 'emissive')}.rgb;`)}
 var nrmSample=vec4f(0.5,0.5,1.0,1.0);
 ${siCarte('normal', `nrmSample=${lecture('dataSample', 'normal')};`)}
 ${siCarte(
   'base',
   // No cutout here: every pixel this pass shades was kept by the raster's test (`maskKeep`,
   // hardware or compute). A second test, on other derivatives or another read, would cut
   // pixels the raster had written the depth of, and leave holes.
   `rgb=rgb*${lecture('colorSample', 'base')}.xyz;`,
 )}
 // The vertex colour, perspective-correct like the texture coordinate, as the forward path reads it.
 if(HAS_VERTEX_COLOR){rgb*=(pageColor(page,t.h,t.k.x)*bary.x+pageColor(page,t.h,t.k.y)*bary.y+pageColor(page,t.h,t.k.z)*bary.z).xyz;}
 if(SHADE_STAGE==6u){shadeProbe=bitcast<u32>(dot(rgb+emissive,vec3f(1.0))+ao+roughSample.y+metalSample.z+f32(request)+dot(m.emissive,vec3f(1.0)));return emptySurface();}
`

/** The wireframe's and the diagnostic views' exits, before the lighting values. */
const SURFACE_VIEWS = (
  o: ShadeOptions,
) => ` // The wireframe's and the x-ray view's surfaces are their background: the edges of every
 // triangle submitted, the hidden ones too, are drawn over the lit image by a pass of their own
 // (\`../../webgpu/visibility/xray.ts\`).
 if(uni.mode==${V.wireframe.code}u||uni.mode==${V.xray.code}u){return diagnosticEmpty(request);}
 // Every other view's colour (\`diagnosticColor\`), the blended resolve's too, shaded by the
 // face's orientation so walls stand out from the ground; the LOD and HLOD colorations by the
 // luminance of the base colour and emission instead (\`diagnosticDebugColor\`) — a voxel's its own.
 // A voxel is a level of its own DAG: its level's colour, the LOD drawn painted whatever its
 // geometry, a brick or a mesh. The screen error is measured
 // here, at the pixel's clip w (\`diagnosticScreenError\`).
 if(uni.mode!=0u){
  var base=rgb+emissive;
${o.graph?.diagnostic ?? ''}${o.voxel ? VOXEL_DIAGNOSTIC : ''}  let depth=dot(bary,vec3f(c0.w,c1.w,c2.w));
  var screenError=0.0;
  if(uni.mode==${V['screen-error'].code}u){screenError=diagnosticScreenError(diagnosticWorldError(page.diagnosticWord,page.world),depth,uni.viewProj,uni.viewport,uni.pixelRatio,uni.pixelError);}
  return diagnosticSurface(diagnosticColor(uni.mode,DiagnosticPixel(page.clusterHash,tri,page.diagnosticWord,CLASS_KEY,base,faceNormal(w0.xyz,w1.xyz,w2.xyz),screenError)),request);
 }
`

/** The normal of the pixel, then a graph's outputs where the module has one. */
export const SURFACE_NORMALS = (
  o: ShadeOptions,
) => ` var metal=ormMetalness(m.metalness,metalSample.z);var rough=ormRoughness(m.roughness,roughSample.y);
${o.voxel ? VOXEL_SURFACE : ''} // The side the screen sees the triangle from: the sign of the weights' steps (\`pixelBarycentric\`), right
  // for original vertices that straddle the near plane too.
  let screenFace=${o.screenFace ?? 'select(-1.0,1.0,pb.dx.y*pb.dy.x-pb.dx.x*pb.dy.y>0.0)'};
  let world3=worldMatrix3(page.world);
  // Face winding of a singular pose does NOT come from its zero determinant: on a flattened
  // face, the adjugate already put the normal on the side of the transformed-edge cross product,
  // and only the side the screen sees it from remains. The determinant test of the row's frame
  // (\`worldWindingKept\`) yields exactly that at a zero determinant — face y is screenFace — like
  // matrixWindingCw on the CPU.
  let face=screenFace*select(-1.0,1.0,worldWindingKept(page));
  let side=select(1.0,-1.0,(page.flags&${FLAG_BACK}u)!=0u);
  // The three vertex normals, turned to \`side\` (\`decodeTriangle\`).
  let n0=t.n0;let n1=t.n1;let n2=t.n2;
  var N=unitOrZero(faceNormal(w0.xyz,w1.xyz,w2.xyz))*screenFace;
  // The curvature of the interpolated vertex normal: its change across the pixel (\`dNx\` right, \`dNy\` down), taken before
  // any map bends it, as the roughness a material that asks for it takes (\`normalCurvatureRoughness\`); only that scalar
  // stays live. A pixel without a vertex normal is flat.
  var curvature=0.0;
  if(HAS_VERTEX_NORMAL){
   N=unitOrZero(n0*bary.x+n1*bary.y+n2*bary.z);
   if(DOUBLE_SIDED){N*=face;}
   if(${normalCurvatureOfModel('m.model')}){
${o.graph ? '' : NEIGHBOUR_WEIGHTS('    ')}
    let faceSide=select(1.0,face,DOUBLE_SIDED);
    let dNx=unitOrZero(n0*bx.x+n1*bx.y+n2*bx.z)*faceSide-N;
    let dNy=unitOrZero(n0*by.x+n1*by.y+n2*by.z)*faceSide-N;
    curvature=normalCurvatureRoughness(dNx,dNy,uni.normalCurvature);
   }
  }else if(${normalCurvatureOfModel('m.model')}){curvature=normalCurvatureFlat(uni.normalCurvature);}
 if(SHADE_STAGE==7u){shadeProbe=bitcast<u32>(dot(N,vec3f(1.0))+curvature+metal+rough+dot(rgb,vec3f(1.0)));return emptySurface();}
${o.voxel ? VOXEL_NORMAL : ''}  // The clear coat bends its own normal map from the normal before the base one (\`physicalWgsl.ts\`).
  var coatBase=N;
  // The tangents the page stores, their frame at the pixel: the one frame the normal map and the
  // lobes bend in (\`physicalValues\`), decoded once.
  var tangents:CotangentFrame;
  if(HAS_TANGENT&&(${o.graph?.normal ? 'true' : `HAS_NORMAL_MAP||(HAS_PHYSICAL&&physicalOn)||(HAS_SHADING_MODEL&&shadingModelOfModel(m.model)==${PIXEL_MODEL.hair}u)`})){tangents=storedTangentFrame(page,t.h,t.k,bary,n0,n1,n2,world3,side);}
  if(HAS_NORMAL_MAP){
   let scale=vec3f(m.normalScale,select(m.normalScaleY,m.tangentNormalScaleY,HAS_TANGENT),1.0);
   let mapN=unitToSigned3(nrmSample.xyz)*scale;
   var T=tangents.T;var B=tangents.B;
   if(!HAS_TANGENT){
    let c=${coordonnee('normal')};
    let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,c.d1,c.d2);
    T=frame.T*screenFace;B=frame.B*screenFace;
   }
   let flip=select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL);
   N=bendNormal(N,T,B,flip,mapN);
  }
${o.graph?.late ?? ''}`

/** The surface models that show something other than light, the flags and the pixel's surface. */
export const SURFACE_TAIL = (
  o: ShadeOptions,
) => ` // The models that show something other than light leave unlit (\`../../scene/surfaceModel.ts\`):
 // a matcap as an unlit material, seen through the fog; a normal or depth view as-is, never fogged
 // nor tone mapped.
 // A held-out primitive, where the alpha holdout is in effect: black, lit by nothing, no light of its own,
 // marked for the colour pass, which gives it an alpha of 1.
 if((page.flags&${FLAG_HOLDOUT}u)!=0u&&uni.holdout!=0u){return SurfaceOut(vec4f(0.0),vec4f(N,1.0),vec4f(0.0,0.0,0.0,1.0),${UNLIT_FLAG}u|${HOLDOUT_SURFACE_FLAG}u,request);}
 if(model==${SURFACE_MODEL.normal}u){rgb=normalViewColor(viewNormal(N));}
 if(model==${SURFACE_MODEL.depth}u){let w=dot(bary,vec3f(c0.w,c1.w,c2.w));let r=uni.depthRamp;rgb=vec3f(clamp(r.x*w+r.y+r.z*dot(bary,vec3f(c0.z,c1.z,c2.z))/w,0.0,1.0));}
 if(model>=${SURFACE_MODEL.normal}u){return SurfaceOut(vec4f(rgb,0.0),vec4f(N,1.0),vec4f(0.0,0.0,0.0,1.0),select(${AS_IS_FLAG}u,${UNLIT_FLAG}u|select(0u,${FOG_FREE_SURFACE_FLAG}u,(page.flags&${FLAG_FOG_FREE}u)!=0u),model==${SURFACE_MODEL.matcap}u),request);}
 var flag=select(${UNLIT_FLAG}u,modelFlag(page.flags),(page.flags&${FLAG_LIT}u)!=0u);
 if((page.flags&${FLAG_FOG_FREE}u)!=0u){flag|=${FOG_FREE_SURFACE_FLAG}u;}
 if((page.flags&${FLAG_DISTANCE_FIELD}u)!=0u){flag|=${DISTANCE_FIELD_REPRESENTATION_FLAG}u;}
${o.graph?.model ?? ''}${materialModelStatements(!!o.graph?.model)}
${o.graph?.specular ?? ''} if(DOUBLE_SIDED&&mmModel==0u&&(page.flags&${FLAG_LIT}u)!=0u){
  var thin=clamp(m.subsurface,vec3f(0.0),vec3f(1.0));
  if(HAS_UV&&m.subsurfaceMap!=0u){let c=mapCoord(m,${SUBSURFACE_MAP_BIT}u);thin*=colorSample(m.subsurfaceMap,c.uv,c.ddx,c.ddy,HAS_SAMPLING).rgb;}
${o.graph?.thin ?? ''}  if(any(thin>vec3f(0.0))){thinOut=thin;thinOpacity=subsurfaceOpacityOfModel(m.model);flag|=${SUBSURFACE_FLAG}u;}
 }
 rough=max(rough,curvature);
 ${o.graph?.lobes ?? ''}${PHYSICAL_LOBES_CALL}
 // The emission-and-occlusion texel is read only under its bit (\`surfaceEmission.ts\`, #1369).
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),flag|emissiveAoFlag(emissive,ao),request);
}
`

/**
 * Surface resolve of one material class: the compute stage every class pipeline compiles with its
 * own feature overrides (`materialClass.ts`), run over that class's pixels alone (`binnedPixel`).
 * `HAS_UV`, `HAS_MAP` and the other class constants are pipeline overrides, never tested per pixel
 * on `page.flags`; a kept path runs the per-pixel test's arithmetic, operand for operand.
 */
export const shadeShader = ({
  diagnostic,
  voxel = false,
  displaced = false,
  graph,
  wpo = NO_WPO,
}: {
  diagnostic?: WgslDecl
  voxel?: boolean
  displaced?: boolean
  graph?: CompiledGraph
  wpo?: WpoSet
} = {}) => {
  const o: ShadeOptions = { voxel, displaced, graph: graph && shadeGraph(graph) }
  const parts = [SURFACE_HEAD, SURFACE_READS, SURFACE_VIEWS, SURFACE_NORMALS, SURFACE_TAIL]
  return wgslProgram(parts.map((part) => part(o)).join(''), [
    SHADE_ENTRY_WGSL,
    NORMAL_VIEW_COLOR_WGSL,
    modelFlag,
    pixelModelFlag,
    quantise8x2,
    quantise8,
    octEncode,
    octDecode,
    subsurfaceOpacityOfModel,
    subsurfaceProfileOfModel,
    shadingModelOfModel,
    shadingUnlitOfModel,
    specularFlag,
    EMISSIVE_AO_FLAG_WGSL,
    o.graph ? shadeDeclWgsl(o.graph.request) : SHADE_DECL_WGSL,
    ...(o.graph ? [o.graph.decl] : []),
    STORED_TANGENT_FRAME_WGSL,
    ORM_LAW_WGSL,
    DIAGNOSTIC_PALETTE_WGSL,
    worldMatrix3,
    ...(voxel ? [VOXEL_HIT_WGSL, VOXEL_SURFACE_WGSL, VOXEL_STEPS_WGSL, cofactor3] : []),
    ...(displaced ? [DISPLACED_PIXEL_WGSL] : []),
    unitOrZero,
    interleavedGradientNoise,
    TILE_NOISE_WGSL,
    edgeFunction,
    PIXEL_BARYCENTRIC_WGSL,
    faceNormal,
    unitToSigned3,
    visPageIndex,
    visTriangle,
    ...(diagnostic ? [diagnostic] : []),
    ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
  ])
}

/** The resolve's module without a diagnostic stage: what production compiles. */
export const SHADE_SHADER = shadeShader()
