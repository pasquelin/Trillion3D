import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { COTANGENT_FRAME_WGSL } from '../../geometry/cluster/cotangentFrameWgsl.ts'
import { SHADE_DECL_WGSL } from './shadeDeclWgsl.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { edgeFunction, perspectiveBarycentric } from '../../../../math/src/wgsl/barycentric.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { SHADOW_RECEIVER_OF_TRIANGLE_WGSL } from './receiverOffsetWgsl.ts'
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
  FOG_FREE_SURFACE_FLAG,
  MODEL_SHIFT,
  NORMAL_VIEW_COLOR_WGSL,
  SURFACE_MODEL,
  modelFlag,
} from '../../materials/surface/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { EMISSIVE_AO_FLAG_WGSL } from '../../materials/surface/surfaceEmission.ts'
import {
  FLAG_BACK,
  FLAG_DISTANCE_FIELD,
  FLAG_FOG_FREE,
  FLAG_LINE,
  FLAG_LIT,
  FLAG_SPRITE,
} from '../types.ts'
import { DISTANCE_FIELD_REPRESENTATION_FLAG } from '../../lighting/distanceField/representationWgsl.ts'
import { PHYSICAL_LOBES_CALL, PHYSICAL_UV_READ } from './physicalWgsl.ts'
import { SHADE_ENTRY_WGSL } from './shadeEntryWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'

/** What a voxel class's resolve adds to the text (`VOXEL`): its own module alone holds it, made
 *  the first time a voxel class is asked (`shadePipelines.ts`); every other class compiles the text
 *  it compiled before voxels. The voxel its pixel shows, its surface in the views and the lit
 *  image, its shadow receiver and its normal. */
const VOXEL_PIXEL = ` // A voxel row's pixel shows the voxel its ray meets in the brick its box's triangle names, traced
 // again from the box's point as the raster traced it (\`voxelRay\`, \`voxelPixel\`): its surface,
 // its normal turned to the eye where the ray is, in the brick's cells, then carried by its joint.
 var voxel=0u;var voxelN=vec3f(0.0);
 if(VOXEL){
  let base=page.pageOffset;let brick=voxelBrickOf(tri);
  let mask=voxelBrickMask(base,brick);let box=voxelMaskBox(mask);
  let k=pageTriangle(page,pageHeaderFor(page,false),tri);
  let o=voxelBoxPoint(box,k.x)*bary.x+voxelBoxPoint(box,k.y)*bary.y+voxelBoxPoint(box,k.z)*bary.z;
  let carry=voxelCarry(page,brick);
  let ray=voxelRay(mask,box,o,uni.viewProj*page.world*carry*voxelCells(page,brick));
  let hit=voxelPixel(ray.start,ray.dir,ray.cells);
  // A ray the raster met a voxel on and this one grazes past reads the brick's first voxel.
  voxel=voxelRank(base,brick,select(0u,hit.bit,hit.found));
  let n=voxelNormal(base,voxel);
  voxelN=unitOrZero(worldMatrix3(page.world)*cofactor3(carry[0].xyz,carry[1].xyz,carry[2].xyz)*select(n,-n,dot(n,ray.dir)>0.0));
  // The trace's cost, on a sampled frame, one pixel in 64 (\`voxelStepsTally\`).
  if(uni.voxelCounting!=0u){voxelStepsTally(pos.xy,hit.steps);}
 }
`
const VOXEL_DIAGNOSTIC = `  if(VOXEL&&(uni.mode==${V.lod.code}u||uni.mode==${V.hlod.code}u)){base=voxelSurface(page.pageOffset,voxel).rgb;}
`
const VOXEL_SURFACE = ` // A voxel wears its own prefiltered surface, the spread of the normals it averages added.
 if(VOXEL){
  let v=voxelSurface(page.pageOffset,voxel);
  rgb=v.rgb;metal=v.metal;ao=v.ao;emissive=vec3f(0.0);
  rough=v.rough;spread=toksvigVariance(v.spread);
 }
`
const VOXEL_RECEIVER = `   // A voxel's receiver is its hit, which the depth already places, and its own normal: no
   // offset from its box's corners.
   rcvOffset=select(receiver.offset,vec3f(0.0),VOXEL);
   rcvPlane=select(receiver.plane,voxelN,VOXEL);
`
const PLAIN_RECEIVER = `   rcvOffset=receiver.offset;
   rcvPlane=receiver.plane;
`
const VOXEL_NORMAL = `  if(VOXEL){N=voxelN;Nx=N;Ny=N;}
`

/** The frame of the tangents a page stores (`pageTangent`) at the weights `bary` of triangle `tri`:
 *  each corner's tangent turned to the world (`world3`) and to the row's `side`, its bitangent the
 *  corner normal's cross with it by its sign, both blended. The one tangent source of a pixel whose
 *  page stores tangents: its normal map and its lobes bend in it (`physicalValues`). */
const STORED_TANGENT_FRAME_WGSL = wgslBlock(
  'STORED_TANGENT_FRAME_WGSL',
  [COTANGENT_FRAME_WGSL],
  `fn storedTangentFrame(page:PageInfo,tri:u32,bary:vec3f,n0:vec3f,n1:vec3f,n2:vec3f,world3:mat3x3f,side:f32)->CotangentFrame{
 let h=pageHeader(page);let k=pageTriangle(page,h,tri);
 let ta=pageTangent(page,h,k.x);let tb=pageTangent(page,h,k.y);let tc=pageTangent(page,h,k.z);
 let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
 let T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
 let B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
 return CotangentFrame(T,B);
}`,
)

/**
 * Surface resolve of one material class: the compute stage every class pipeline compiles with its
 * own feature overrides (`materialClass.ts`), run over that class's pixels alone (`binnedPixel`).
 * `HAS_UV`, `HAS_MAP` and the other class constants are pipeline overrides, never tested per pixel
 * on `page.flags`; a kept path runs the per-pixel test's arithmetic, operand for operand.
 */
export const shadeShader = ({
  diagnostic,
  voxel = false,
}: { diagnostic?: WgslDecl; voxel?: boolean } = {}) =>
  wgslProgram(
    `/** The surfaces of a pixel of the class's bin (\`binnedPixel\`), its storage values in the variables of
 *  its entry (\`shadeEntryWgsl.ts\`); its surface's factors and maps its record's (\`materialAt\`). */
fn shadeSurface(pos:vec4f,id:u32)->SurfaceOut{
 let pageIndex=visPageIndex(id);
 let tri=visTriangle(id);
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
 let m=materialAt(page.material);
 // The triangle, as the triangles pass stored it or decoded here (\`pixelTriangle\`).
 let t=pixelTriangle(pageIndex,page,tri);
 let w0=t.w0;let w1=t.w1;let w2=t.w2;
 // A corner's pixel in x and y, its clip depth and w: the parts of \`framebuffer(c)\` and of \`c\`
 // the resolve reads (\`decodeTriangle\`).
 let s0=t.p0.xyz;let s1=t.p1.xyz;let s2=t.p2.xyz;let c0=t.p0;let c1=t.p1;let c2=t.p2;
 let p=vec2f(pos.x,pos.y);
 let area=edgeFunction(s1.xy,s2.xy,s0.xy);
 var rgb=m.baseColor;
 let bary=perspectiveBarycentric(s0,s1,s2,t.iw,p,area);
${voxel ? VOXEL_PIXEL : ''} var uv=vec2f(0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if(HAS_UV){
  uv=t.uva*bary.x+t.uvb*bary.y+t.uvc*bary.z;
  let g=uvGradients(s0.xy,s1.xy,s2.xy,p,t.uva,t.uvb,t.uvc,t.iw);
  ddx=g[0];ddy=g[1];
 }
 let model=(page.flags>>${MODEL_SHIFT}u)&7u;
 // A matcap material reads its image by the view-space normal: the base map at that coordinate,
 // from the triangle's world normals the decode turned to the row's side (\`decodeTriangle\`).
 if(model==${SURFACE_MODEL.matcap}u){
  uv=matcapUv(unitOrZero(t.n0*bary.x+t.n1*bary.y+t.n2*bary.z));
  ddx=vec2f(0.0);ddy=vec2f(0.0);
 }
 // The pixel's UV sets and its anisotropic and clear-coat record, which the tile request reads too.
 ${PHYSICAL_UV_READ}
 let request=shadeRequest(m,pos.xy);
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
 if(HAS_VERTEX_COLOR){let h=pageHeader(page);let k=pageTriangle(page,h,tri);rgb*=(pageColor(page,h,k.x)*bary.x+pageColor(page,h,k.y)*bary.y+pageColor(page,h,k.z)*bary.z).xyz;}
 // The wireframe's and the x-ray view's surfaces are their background: the edges of every
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
${voxel ? VOXEL_DIAGNOSTIC : ''}  let depth=dot(bary,vec3f(c0.w,c1.w,c2.w));
  var screenError=0.0;
  if(uni.mode==${V['screen-error'].code}u){screenError=diagnosticScreenError(diagnosticWorldError(page.diagnosticWord,page.world),depth,uni.viewProj,uni.viewport,uni.pixelRatio,uni.pixelError);}
  return diagnosticSurface(diagnosticColor(uni.mode,DiagnosticPixel(page.clusterHash,tri,page.diagnosticWord,CLASS_KEY,base,faceNormal(w0.xyz,w1.xyz,w2.xyz),screenError)),request);
 }
 var metal=ormMetalness(m.metalness,metalSample.z);var rough=ormRoughness(m.roughness,roughSample.y);
 // The spread of the normals under the pixel the roughness is widened by (\`roughnessWidened\`).
 var spread=0.0;
${voxel ? VOXEL_SURFACE : ''} // Original vertices may straddle the near plane; recover the clipped winding.
  let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
  let world3=worldMatrix3(page.world);
  // Face winding of a singular pose does NOT come from its zero determinant: on a flattened
  // face, the adjugate already put the normal on the side of the transformed-edge cross product,
  // and only the side the screen sees it from remains. The determinant test of the row's frame
  // (\`composeRowFrame\`) yields exactly that at a zero determinant — face y is screenFace — like
  // matrixWindingCw on the CPU.
  let face=screenFace*select(-1.0,1.0,rowFrame(pageIndex,page.world).positive);
  let side=select(1.0,-1.0,(page.flags&${FLAG_BACK}u)!=0u);
  // The three vertex normals, turned to \`side\` (\`decodeTriangle\`), the receiver offset reads too.
  let n0=t.n0;let n1=t.n1;let n2=t.n2;
  // The shadow receiver, once, from this decode (\`receiverTargetWgsl.ts\`), which every shadow
  // read takes (\`receiverOffsetWgsl.ts\`).
  if(HAS_VERTEX_NORMAL&&(page.flags&${FLAG_SPRITE | FLAG_LINE}u)==0u){
   let receiver=shadowReceiverOfTriangle(bary,w0,w1,w2,n0,n1,n2,select(1.0,face,DOUBLE_SIDED));
${voxel ? VOXEL_RECEIVER : PLAIN_RECEIVER}  }
  var N=unitOrZero(faceNormal(w0.xyz,w1.xyz,w2.xyz))*screenFace;
  // The shading normal one pixel right (\`Nx\`) and one down (\`Ny\`), the same plane's: its change
  // across the pixel, which widens the roughness (\`normalFootprintVariance\`); a flat face's none.
  var Nx=N;var Ny=N;
  if(HAS_VERTEX_NORMAL){
   N=unitOrZero(n0*bary.x+n1*bary.y+n2*bary.z);
   let bx=perspectiveBarycentric(s0,s1,s2,t.iw,p+vec2f(1.0,0.0),area);
   let by=perspectiveBarycentric(s0,s1,s2,t.iw,p+vec2f(0.0,1.0),area);
   Nx=unitOrZero(n0*bx.x+n1*bx.y+n2*bx.z);
   Ny=unitOrZero(n0*by.x+n1*by.y+n2*by.z);
   if(DOUBLE_SIDED){N*=face;Nx*=face;Ny*=face;}
  }
${voxel ? VOXEL_NORMAL : ''}  // The clear coat bends its own normal map from the normal before the base one (\`physicalWgsl.ts\`).
  let coatBase=N;
  // The tangents the page stores, their frame at the pixel: the one frame the normal map and the
  // lobes bend in (\`physicalValues\`), decoded once.
  var tangents:CotangentFrame;
  if(HAS_TANGENT&&(HAS_NORMAL_MAP||(HAS_PHYSICAL&&physicalOn))){tangents=storedTangentFrame(page,tri,bary,n0,n1,n2,world3,side);}
  if(HAS_NORMAL_MAP){
   let scale=vec3f(m.normalScale,select(m.normalScaleY,m.tangentNormalScaleY,HAS_TANGENT),1.0);
   let mapN=unitToSigned3(nrmSample.xyz)*scale;
   // The map one pixel right and one down, at the same level: its own change across the pixel.
   let nc=${coordonnee('normal')};
   let mapNx=unitToSigned3(dataSample(m.normalIndex,nc.uv+nc.ddx,nc.ddx,nc.ddy,HAS_SAMPLING).xyz)*scale;
   let mapNy=unitToSigned3(dataSample(m.normalIndex,nc.uv+nc.ddy,nc.ddx,nc.ddy,HAS_SAMPLING).xyz)*scale;
   var T=tangents.T;var B=tangents.B;
   if(!HAS_TANGENT){
    let c=${coordonnee('normal')};
    let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,c.d1,c.d2);
    T=frame.T*screenFace;B=frame.B*screenFace;
   }
   let flip=select(1.0,face,DOUBLE_SIDED&&HAS_VERTEX_NORMAL);
   N=bendNormal(N,T,B,flip,mapN);
   Nx=bendNormal(Nx,T,B,flip,mapNx);
   Ny=bendNormal(Ny,T,B,flip,mapNy);
  }
 // The models that show something other than light leave unlit (\`../../scene/surfaceModel.ts\`):
 // a matcap as an unlit material, seen through the fog; a normal or depth view as-is, never fogged
 // nor tone mapped.
 if(model==${SURFACE_MODEL.normal}u){rgb=normalViewColor(viewNormal(N));}
 if(model==${SURFACE_MODEL.depth}u){let w=dot(bary,vec3f(c0.w,c1.w,c2.w));let r=uni.depthRamp;rgb=vec3f(clamp(r.x*w+r.y+r.z*dot(bary,vec3f(c0.z,c1.z,c2.z))/w,0.0,1.0));}
 if(model>=${SURFACE_MODEL.normal}u){return SurfaceOut(vec4f(rgb,0.0),vec4f(N,1.0),vec4f(0.0,0.0,0.0,1.0),select(${AS_IS_FLAG}u,1u|select(0u,${FOG_FREE_SURFACE_FLAG}u,(page.flags&${FLAG_FOG_FREE}u)!=0u),model==${SURFACE_MODEL.matcap}u),request);}
 var flag=select(1u,modelFlag(page.flags),(page.flags&${FLAG_LIT}u)!=0u);
 if((page.flags&${FLAG_FOG_FREE}u)!=0u){flag|=${FOG_FREE_SURFACE_FLAG}u;}
 if((page.flags&${FLAG_DISTANCE_FIELD}u)!=0u){flag|=${DISTANCE_FIELD_REPRESENTATION_FLAG}u;}
 if(DOUBLE_SIDED&&(page.flags&${FLAG_LIT}u)!=0u){
  var thin=clamp(m.subsurface,vec3f(0.0),vec3f(1.0));
  if(HAS_UV&&m.subsurfaceMap!=0u){let c=mapCoord(m,${SUBSURFACE_MAP_BIT}u);thin*=colorSample(m.subsurfaceMap,c.uv,c.ddx,c.ddy,HAS_SAMPLING).rgb;}
  if(any(thin>vec3f(0.0))){thinOut=thin;flag|=${SUBSURFACE_FLAG}u;}
 }
 rough=ormRoughness(1.0,roughnessWidened(rough,spread+normalFootprintVariance(Nx-N,Ny-N)));
 ${PHYSICAL_LOBES_CALL}
 // The emission-and-occlusion texel is read only under its bit (\`surfaceEmission.ts\`, #1369).
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),flag|emissiveAoFlag(emissive,ao),request);
}
`,
    [
      SHADE_ENTRY_WGSL,
      NORMAL_VIEW_COLOR_WGSL,
      modelFlag,
      EMISSIVE_AO_FLAG_WGSL,
      SHADE_DECL_WGSL,
      STORED_TANGENT_FRAME_WGSL,
      ORM_LAW_WGSL,
      DIAGNOSTIC_PALETTE_WGSL,
      worldMatrix3,
      ...(voxel ? [VOXEL_HIT_WGSL, VOXEL_SURFACE_WGSL, VOXEL_STEPS_WGSL, cofactor3] : []),
      unitOrZero,
      edgeFunction,
      perspectiveBarycentric,
      faceNormal,
      SHADOW_RECEIVER_OF_TRIANGLE_WGSL,
      unitToSigned3,
      visPageIndex,
      visTriangle,
      ...(diagnostic ? [diagnostic] : []),
    ],
  )

/** The resolve's module without a diagnostic stage: what production compiles. */
export const SHADE_SHADER = shadeShader()
