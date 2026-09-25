import { SHADE_DECL_WGSL } from './shadeDeclWgsl.ts';
import { lecture, lectureDonnee, siCarte } from './maps.ts';
import { MODEL_FLAG, MODEL_SHIFT, SURFACE_MODEL } from '../../scene/surfaceModel.ts';

/**
 * Surface resolve of one material class: the fragment stage every class pipeline compiles with its
 * own feature overrides (`materialClass.ts`), run under the material-depth test on that
 * class's pixels only. `HAS_UV`, `HAS_MAP` and the other class constants replace what used to be
 * tested per pixel on `page.flags`; the arithmetic of a kept path is the same, operand for operand.
 */
export const SHADE_SHADER = `${SHADE_DECL_WGSL}
@fragment fn shade_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 // The depth test admitted this pixel: its page exists and is of this class.
 let id=textureLoad(vis,vec2<i32>(i32(pos.x),i32(pos.y)),0).r;
 let pageIndex=(id>>8u)-1u;let tri=id&0xffu;
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount){return emptySurface();}
 let h=pageHeader(page);
 let i0=pageCorner(page,h,tri*3u);let i1=pageCorner(page,h,tri*3u+1u);let i2=pageCorner(page,h,tri*3u+2u);
 let p0=pagePosition(page,h,i0);let p1=pagePosition(page,h,i1);let p2=pagePosition(page,h,i2);
 let w0=page.world*vec4f(p0,1.0);let w1=page.world*vec4f(p1,1.0);let w2=page.world*vec4f(p2,1.0);
 let c0=uni.viewProj*w0;let c1=uni.viewProj*w1;let c2=uni.viewProj*w2;
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let p=vec2f(pos.x,pos.y);
 let area=edge(s1.xy,s2.xy,s0.xy);
 var rgb=page.baseColor.xyz;
 var bary=vec3f(0.333,0.333,0.334);
 var uv=vec2f(0.0);
 if(area!=0.0){
  let bw=baryWeights(s0.xy,s1.xy,s2.xy,p,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
  let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
  let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
  bary=select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
 }
 let absArea=abs(area);
 let width=select(vec3f(0.005),vec3f(abs(s1.y-s2.y)+abs(s2.x-s1.x),abs(s2.y-s0.y)+abs(s0.x-s2.x),abs(s0.y-s1.y)+abs(s1.x-s0.x))/absArea,absArea>0.0);
 var ddx=vec2f(0.0);var ddy=vec2f(0.0);
 if(HAS_UV){
  let uva=pageUv(page,h,i0);let uvb=pageUv(page,h,i1);let uvc=pageUv(page,h,i2);
  uv=uva*bary.x+uvb*bary.y+uvc*bary.z;
  let g=uvGradients(s0.xy,s1.xy,s2.xy,p,uva,uvb,uvc,vec3f(1.0/c0.w,1.0/c1.w,1.0/c2.w));
  ddx=g[0];ddy=g[1];
 }
 let model=(page.flags>>${MODEL_SHIFT}u)&7u;
 // A matcap material reads its image by the view-space normal: the base map at that coordinate.
 if(model==${SURFACE_MODEL.matcap}u){
  let it=invTranspose3Prep(mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz));
  uv=matcapUv(uniteOuZero(invTranspose3Apply(it,pageNormal(page,h,i0))*bary.x+invTranspose3Apply(it,pageNormal(page,h,i1))*bary.y+invTranspose3Apply(it,pageNormal(page,h,i2))*bary.z));
  ddx=vec2f(0.0);ddy=vec2f(0.0);
 }
 let request=shadeRequest(page,h,pos.xy,uv,ddx,ddy,w0,w1,w2,i0,i1,i2,w0*bary.x+w1*bary.y+w2*bary.z);
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
 if(HAS_VERTEX_COLOR){rgb*=(pageColor(page,h,i0)*bary.x+pageColor(page,h,i1)*bary.y+pageColor(page,h,i2)*bary.z).xyz;}
 if(uni.mode==1u){
  let edgeW=1.0-min(min(smoothstep(0.0,width.x*1.2,bary.x),smoothstep(0.0,width.y*1.2,bary.y)),smoothstep(0.0,width.z*1.2,bary.z));
  return diagnosticSurface(mix(hashColor(stableTriangleId(page.clusterHash,tri)),vec3f(0.04,0.05,0.07),edgeW),request);
 }
 if(uni.mode==2u){return diagnosticSurface(hashColor(page.clusterHash),request);}
 if(uni.mode==3u){return diagnosticSurface(vec3f(0.204,0.827,0.6),request);}
 if(uni.mode==4u){return diagnosticSurface(select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),page.pad1>0.5),request);}
 if(uni.mode==5u){return diagnosticSurface(vec3f(0.204,0.827,0.6),request);}
 if(uni.mode==6u){let ratio=clamp(page.pad4.x,0.0,1.0);return diagnosticSurface(vec3f(ratio,1.0-ratio,0.12),request);}
 if(uni.mode==7u){return diagnosticSurface(hashColor(CLASS_KEY),request);}
 var metal=clamp(page.metalness*metalSample.z,0.0,1.0);var rough=clamp(page.roughness*roughSample.y,0.0525,1.0);
 // Original vertices may straddle the near plane; recover the clipped winding.
  let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
  let world3=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
  // Face winding of a singular pose does NOT come from its zero determinant: on a flattened
  // face, the adjugate already put the normal on the side of the transformed-edge cross product,
  // and only the side the screen sees it from remains. The determinant test below yields
  // exactly that at a zero determinant — face y is screenFace — like matrixWindingCw on the CPU.
  let face=screenFace*select(-1.0,1.0,determinant(world3)>=0.0);
  let side=select(1.0,-1.0,(page.flags&256u)!=0u);
  // The three triangle normals undergo the SAME matrix: normalisation, determinant and
  // adjugate are computed once for the pixel, and each normal only keeps the 3×3 product.
  // xformNormal did this prologue three times; the operand and per-normal order do not move.
  // uniteOuZero returns normalize on any non-zero vector, hence the same bits as before on a
  // regular pose; it only differs where normalize would yield NaN — collapsed face, degenerate triangle.
  // On a rank-2 pose, invTranspose3Apply returns the transformed FACE normal: the three
  // vertex normals fall on the same direction, and interpolation keeps it.
  let invT=invTranspose3Prep(world3);
  var n0=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i0)))*side;
  var n1=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i1)))*side;
  var n2=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i2)))*side;
  var N=uniteOuZero(cross((w1-w0).xyz,(w2-w0).xyz))*screenFace;
  if(HAS_VERTEX_NORMAL){
   N=uniteOuZero(n0*bary.x+n1*bary.y+n2*bary.z);
   if(DOUBLE_SIDED){N*=face;}
  }
  if(HAS_NORMAL_MAP){
   let nrm=nrmSample.xyz*2.0-vec3f(1.0);
   let mapN=vec3f(nrm.x*page.normalScale,nrm.y*page.normalScaleY,nrm.z);
   var T=vec3f(0.0);var B=vec3f(0.0);
   if(HAS_TANGENT){
    let ta=vertT(page.vertexBase,i0);let tb=vertT(page.vertexBase,i1);let tc=vertT(page.vertexBase,i2);
    let t0=normalize(world3*ta.xyz)*side;let t1=normalize(world3*tb.xyz)*side;let t2=normalize(world3*tc.xyz)*side;
    T=normalize(t0*bary.x+t1*bary.y+t2*bary.z);
    B=normalize(normalize(cross(n0,t0)*ta.w)*bary.x+normalize(cross(n1,t1)*tb.w)*bary.y+normalize(cross(n2,t2)*tc.w)*bary.z);
   }else{
    let ua=pageUv(page,h,i0);
    let frame=cotangentFrame(N,(w1-w0).xyz,(w2-w0).xyz,pageUv(page,h,i1)-ua,pageUv(page,h,i2)-ua);
    T=frame.T*screenFace;B=frame.B*screenFace;
   }
   if(DOUBLE_SIDED&&HAS_VERTEX_NORMAL){T*=face;B*=face;}
   N=uniteOuZero(T*mapN.x+B*mapN.y+N*mapN.z);
  }
 // The models that show something other than light leave unlit (\`../../scene/surfaceModel.ts\`):
 // a matcap as an unlit material, seen through the fog; a normal or depth view as-is, never fogged.
 if(model==${SURFACE_MODEL.normal}u){rgb=viewNormal(N)*0.5+0.5;}
 if(model==${SURFACE_MODEL.depth}u){let w=dot(bary,vec3f(c0.w,c1.w,c2.w));let r=uni.depthRamp;rgb=vec3f(clamp(r.x*w+r.y+r.z*dot(bary,vec3f(c0.z,c1.z,c2.z))/w,0.0,1.0));}
 if(model>=${SURFACE_MODEL.normal}u){return SurfaceOut(vec4f(rgb,0.0),vec4f(N,1.0),vec4f(0.0,0.0,0.0,1.0),select(3u,1u,model==${SURFACE_MODEL.matcap}u),request);}
 var flag=select(1u,2u,(page.flags&1u)!=0u);
 if(flag==2u&&model==${SURFACE_MODEL.diffuse}u){flag=${MODEL_FLAG.diffuse}u;}
 if(flag==2u&&model==${SURFACE_MODEL.toon}u){flag=${MODEL_FLAG.toon}u;}
 return SurfaceOut(vec4f(rgb,metal),vec4f(N,rough),vec4f(emissive,ao),flag,request);
}
`;
