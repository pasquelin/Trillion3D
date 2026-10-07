import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { SHADE_DECL_WGSL } from './shadeDeclWgsl.ts'
import { invTranspose3Apply, uniteOuZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { edgeFunction, perspectiveBarycentric } from '../../../../math/src/wgsl/barycentric.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { SHADE_MODE } from './shadeMode.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstantsWgsl.ts'
import { lecture, lectureDonnee, siCarte } from './maps.ts'
import {
  AS_IS_FLAG,
  FOG_FREE_SURFACE_FLAG,
  MODEL_FLAG,
  MODEL_SHIFT,
  NORMAL_VIEW_COLOR_WGSL,
  SURFACE_MODEL,
} from '../../scene/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts'
import { EMISSIVE_AO_FLAG_WGSL } from '../../scene/surfaceEmission.ts'
import { FLAG_FOG_FREE } from '../types.ts'
import { PHYSICAL_LOBES_CALL, PHYSICAL_UV_READ } from './physicalWgsl.ts'

/**
 * Surface resolve of one material class: the fragment stage every class pipeline compiles with its
 * own feature overrides (`materialClass.ts`), kept on that class's pixels only (`classAdmits`).
 * `HAS_UV`, `HAS_MAP` and the other class constants are pipeline overrides, never tested per pixel
 * on `page.flags`; a kept path runs the per-pixel test's arithmetic, operand for operand.
 */
export const shadeShader = ({ diagnostic }: { diagnostic?: WgslDecl } = {}) =>
  wgslProgram(
    `/** What the resolve of a pixel leaves for its two storage writes (\`shade_fs\`): its thin
 *  transmission, and its shadow receiver's offset and plane. Private, so zero at each pixel's start:
 *  a path that finds none leaves zero, as a cleared texel holds. */
var<private> thinOut:vec3f;
var<private> rcvOffset:vec3f;
var<private> rcvPlane:vec3f;
/** The surfaces of an admitted pixel (\`classAdmits\`), its storage values in the variables above. */
fn shadeSurface(pos:vec4f,id:u32)->SurfaceOut{
 let pageIndex=(id>>8u)-1u;
 let tri=id&0xffu;
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
 // The triangle, as the triangles pass stored it or decoded here (\`pixelTriangle\`).
 let t=pixelTriangle(pageIndex,page,tri);
 let w0=t.w0;let w1=t.w1;let w2=t.w2;
 // A corner's pixel in x and y, its clip depth and w: the parts of \`framebuffer(c)\` and of \`c\`
 // the resolve reads (\`decodeTriangle\`).
 let s0=t.p0.xyz;let s1=t.p1.xyz;let s2=t.p2.xyz;let c0=t.p0;let c1=t.p1;let c2=t.p2;
 let p=vec2f(pos.x,pos.y);
 let area=edgeFunction(s1.xy,s2.xy,s0.xy);
 var rgb=page.baseColor.xyz;
 let bary=perspectiveBarycentric(s0,s1,s2,t.iw,p,area);
 var uv=vec2f(0.0);
 let absArea=abs(area);
 let width=select(vec3f(0.005),vec3f(abs(s1.y-s2.y)+abs(s2.x-s1.x),abs(s2.y-s0.y)+abs(s0.x-s2.x),abs(s0.y-s1.y)+abs(s1.x-s0.x))/absArea,absArea>0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if(HAS_UV){
  uv=t.uva*bary.x+t.uvb*bary.y+t.uvc*bary.z;
  let g=uvGradients(s0.xy,s1.xy,s2.xy,p,t.uva,t.uvb,t.uvc,t.iw);
  ddx=g[0];ddy=g[1];
 }
 let model=(page.flags>>${MODEL_SHIFT}u)&7u;
 // A matcap material reads its image by the view-space normal: the base map at that coordinate.
 if(model==${SURFACE_MODEL.matcap}u){
  // The row's normal matrix, as the rows pass composed it (\`rowFrame\`).
  let it=rowFrame(pageIndex,page.world).invT;let h=pageHeader(page);let k=pageTriangle(page,h,tri);
  uv=matcapUv(uniteOuZero(invTranspose3Apply(it,pageNormal(page,h,k.x))*bary.x+invTranspose3Apply(it,pageNormal(page,h,k.y))*bary.y+invTranspose3Apply(it,pageNormal(page,h,k.z))*bary.z));
  ddx=vec2f(0.0);ddy=vec2f(0.0);
 }
 // The anisotropic and clear-coat record and its UV sets, which the tile request reads too.
 ${PHYSICAL_UV_READ}
 let request=shadeRequest(page,pos.xy,uv,ddx,ddy);
 var roughSample=vec4f(1.0);
 ${siCarte('rough', `roughSample=${lecture('dataSample', 'rough')};`)}
 var metalSample=vec4f(1.0);
 ${lectureDonnee('metalSample', 'metal', [['roughSample', 'rough']])}
 var aoSample=vec4f(1.0);
 ${lectureDonnee('aoSample', 'ao', [
   ['roughSample', 'rough'],
   ['metalSample', 'metal'],
 ])}
 let ao=1.0+page.aoIntensity*(aoSample.r-1.0);
 var emissive=page.emissive.xyz;
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
 if(uni.mode==${SHADE_MODE.wireframe}u){
  let edgeW=1.0-min(min(smoothstep(0.0,width.x*1.2,bary.x),smoothstep(0.0,width.y*1.2,bary.y)),smoothstep(0.0,width.z*1.2,bary.z));
  return diagnosticSurface(mix(hashColor(stableTriangleId(page.clusterHash,tri)),vec3f(0.04,0.05,0.07),edgeW),request);
 }
 if(uni.mode==${SHADE_MODE.clusters}u){return diagnosticSurface(hashColor(page.clusterHash),request);}
 if(uni.mode==${SHADE_MODE.pages}u){return diagnosticSurface(vec3f(0.204,0.827,0.6),request);}
 if(uni.mode==${SHADE_MODE.lod}u){return diagnosticSurface(select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),page.pad1>0.5),request);}
 if(uni.mode==${SHADE_MODE.visibility}u){return diagnosticSurface(vec3f(0.204,0.827,0.6),request);}
 if(uni.mode==${SHADE_MODE['screen-error']}u){let ratio=clamp(page.screenError,0.0,1.0);return diagnosticSurface(vec3f(ratio,1.0-ratio,0.12),request);}
 if(uni.mode==${SHADE_MODE.materials}u){return diagnosticSurface(hashColor(CLASS_KEY),request);}
 var metal=clamp(page.metalness*metalSample.z,0.0,1.0);var rough=clamp(page.roughness*roughSample.y,ROUGHNESS_FLOOR,1.0);
 // Original vertices may straddle the near plane; recover the clipped winding.
  let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
  let world3=worldMatrix3(page.world);
  // Face winding of a singular pose does NOT come from its zero determinant: on a flattened
  // face, the adjugate already put the normal on the side of the transformed-edge cross product,
  // and only the side the screen sees it from remains. The determinant test of the row's frame
  // (\`composeRowFrame\`) yields exactly that at a zero determinant — face y is screenFace — like
  // matrixWindingCw on the CPU.
  let face=screenFace*select(-1.0,1.0,rowFrame(pageIndex,page.world).positive);
  let side=select(1.0,-1.0,(page.flags&256u)!=0u);
  // The three vertex normals, turned to \`side\` (\`decodeTriangle\`), the receiver offset reads too.
  let n0=t.n0;let n1=t.n1;let n2=t.n2;
  // The shadow receiver, once, from this decode (\`receiverTargetWgsl.ts\`): \`shadowReceiver\`'s
  // arithmetic (\`receiverOffsetWgsl.ts\`), its point on the Phong surface and its triangle's plane.
  if(HAS_VERTEX_NORMAL&&page.sprite.y==0.0&&page.lineWidth==0.0){
   let lit=select(1.0,face,DOUBLE_SIDED);
   let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
   rcvOffset=shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n0*lit,n1*lit,n2*lit);
   rcvPlane=faceNormal(w0.xyz,w1.xyz,w2.xyz);
  }
  var N=uniteOuZero(faceNormal(w0.xyz,w1.xyz,w2.xyz))*screenFace;
  if(HAS_VERTEX_NORMAL){
   N=uniteOuZero(n0*bary.x+n1*bary.y+n2*bary.z);
   if(DOUBLE_SIDED){N*=face;}
  }
  // The clear coat bends its own normal map from the normal before the base one (\`physicalWgsl.ts\`).
  let coatBase=N;
  if(HAS_NORMAL_MAP){
   let nrm=nrmSample.xyz*2.0-vec3f(1.0);
   let mapN=vec3f(nrm.x*page.normalScale,nrm.y*page.normalScaleY,nrm.z);
   var T=vec3f(0.0);var B=vec3f(0.0);
   if(HAS_TANGENT){
    let k=pageTriangle(page,pageHeaderFor(page,false),tri);
    let ta=vertT(page.vertexBase,k.x);let tb=vertT(page.vertexBase,k.y);let tc=vertT(page.vertexBase,k.z);
    let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
    T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
    B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
   }else{
    let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,t.uvb-t.uva,t.uvc-t.uva);
    T=frame.T*screenFace;B=frame.B*screenFace;
   }
   if(DOUBLE_SIDED&&HAS_VERTEX_NORMAL){T*=face;B*=face;}
   N=uniteOuZero(T*mapN.x+B*mapN.y+N*mapN.z);
  }
 // The models that show something other than light leave unlit (\`../../scene/surfaceModel.ts\`):
 // a matcap as an unlit material, seen through the fog; a normal or depth view as-is, never fogged
 // nor tone mapped.
 if(model==${SURFACE_MODEL.normal}u){rgb=normalViewColor(viewNormal(N));}
 if(model==${SURFACE_MODEL.depth}u){let w=dot(bary,vec3f(c0.w,c1.w,c2.w));let r=uni.depthRamp;rgb=vec3f(clamp(r.x*w+r.y+r.z*dot(bary,vec3f(c0.z,c1.z,c2.z))/w,0.0,1.0));}
 if(model>=${SURFACE_MODEL.normal}u){return SurfaceOut(vec4f(rgb,0.0),vec4f(N,1.0),vec4f(0.0,0.0,0.0,1.0),select(${AS_IS_FLAG}u,1u|select(0u,${FOG_FREE_SURFACE_FLAG}u,(page.flags&${FLAG_FOG_FREE}u)!=0u),model==${SURFACE_MODEL.matcap}u),request);}
 var flag=select(1u,2u,(page.flags&1u)!=0u);
 if(flag==2u&&model==${SURFACE_MODEL.diffuse}u){flag=${MODEL_FLAG.diffuse}u;}
 if(flag==2u&&model==${SURFACE_MODEL.toon}u){flag=${MODEL_FLAG.toon}u;}
 if((page.flags&${FLAG_FOG_FREE}u)!=0u){flag|=${FOG_FREE_SURFACE_FLAG}u;}
 if(DOUBLE_SIDED&&(page.flags&1u)!=0u){
  var thin=clamp(vec3f(page.subsurfaceRG,page.subsurfaceB),vec3f(0.0),vec3f(1.0));
  if(HAS_UV&&page.subsurfaceMap!=0u){thin*=colorSample(page.subsurfaceMap,uv,ddx,ddy,HAS_SAMPLING).rgb;}
  if(any(thin>vec3f(0.0))){thinOut=thin;flag|=${SUBSURFACE_FLAG}u;}
 }
 ${PHYSICAL_LOBES_CALL}
 // The emission-and-occlusion texel is read only under its bit (\`surfaceEmission.ts\`, #1369).
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),flag|emissiveAoFlag(emissive,ao),request);
}
@fragment fn shade_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let id=textureLoad(vis,vec2<i32>(i32(pos.x),i32(pos.y)),0).r;
 // The background, a page past the table and another class are rejected before any write.
 if(!classAdmits(id)){discard;}
 let surface=shadeSurface(pos,id);
 // Each storage texel written once, with its final value: zero unless the resolve set it.
 storeSubsurface(pos.xy,thinOut);
 storeReceiver(pos.xy,rcvOffset,rcvPlane);
 return surface;
}
`,
    [
      NORMAL_VIEW_COLOR_WGSL,
      EMISSIVE_AO_FLAG_WGSL,
      SHADE_DECL_WGSL,
      ROUGHNESS_FLOOR,
      worldMatrix3,
      invTranspose3Apply,
      uniteOuZero,
      edgeFunction,
      perspectiveBarycentric,
      faceNormal,
      ...(diagnostic ? [diagnostic] : []),
    ],
  )

/** The resolve's module without a diagnostic stage: what production compiles. */
export const SHADE_SHADER = shadeShader()
