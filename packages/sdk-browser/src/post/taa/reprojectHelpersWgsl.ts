import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/** The kernel's helpers: the dilated vector, the edge of the neighbourhood's motion and the parallax
 *  disocclusion test. */
export const REPROJECT_HELPERS_TEXT = `fn dilatedVector(n:vec2i)->vec2f{
 let offset=closestOffsetOf(n);
 let q=clampTexel(n+offset);
 let word=textureLoad(vectors,q,0).r;
 if(hasOwnMotion(word)||all(offset==vec2i(0))){return decodeVector(word);}
 return cameraOnlyMotion(screenOfTexel(n),textureLoad(depth,q,0));
}
fn neighbourEdge(p:vec2i)->f32{
 var v:array<vec2f,9>;
 for(var k=0;k<9;k++){v[k]=pixelVelocity(dilatedVector(clampTexel(p+vec2i(k%3-1,k/3-1))));}
 let centre=v[4];
 var edge=1.0;
 for(var k=0;k<4;k++){
  let o=vec2i(k%3-1,k/3-1);
  let d0=centre-v[4+o.x+3*o.y];let d1=centre-v[4-o.x-3*o.y];
  let e0=1.0-dot(saturate(abs(d0*vec2f(o))),vec2f(1.0));
  let e1=1.0-dot(saturate(abs(d1*vec2f(-o))),vec2f(1.0));
  edge=min(edge,min(e0,e1));
 }
 return saturate(edge*1.1);
}
fn exposedShading(g:vec3f)->vec3f{return exposedShadingBy(g,view.exposure.y);}
struct TaaParallax{disoccluded:bool,velocity:vec2f,canFill:bool}
fn parallaxTest(screen:vec2f,v:vec2f,prevZ:f32,zError:f32,offScreen:bool)->TaaParallax{
 let size=vec2i(view.render.xy);
 let worldDepth=sceneDepthOf(prevZ);
 let worldDepthError=abs(worldDepth-sceneDepthOf(prevZ+zError));
 let r=ndcToPixel(screen-v,view.render.xy)-0.5;
 let base=vec2i(floor(r));let f=r-vec2f(base);
 let ortho=view.radius.w!=0.0;
 let count=u32(size.x)*u32(size.y);
 var mask=0.0;var anyValid=false;var fill=0u;var nearest=0.0;
 for(var j=0u;j<4u;j++){
  let d=vec2i(i32(j&1u),i32(j>>1u));let at=base+d;
  if(any(at<vec2i(0))||any(at>=size)){continue;}
  let w=mix(1.0-f.x,f.x,f32(d.x))*mix(1.0-f.y,f.y,f32(d.y));
  let index=u32(at.y)*u32(size.x)+u32(at.x);
  let word=occluders[index];
  var z=0.0;
  if(ortho){
   let low=occluders[count+index];
   z=orthoOccluderDepth(word);
   if(z>nearest){nearest=z;fill=orthoOccluderFill(word,low);}
  }else{
   z=occluderDepth(word);
   fill=max(fill,word);
  }
  let depth=sceneDepthOf(z);
  let epsilon=pixelRadiusAt(depth)*6.0+worldDepthError;
  mask+=w*saturate(2.0-abs(depth-worldDepth)/max(epsilon,1e-30));
  anyValid=true;
 }
 let hole=decodeHoleFill(fill);
 let encodable=hole.y<HOLE_FILL_LENGTH_MAX;
 let fillVelocity=vec2f(cos(hole.x),sin(hole.x))*hole.y;
 if(encodable){
  let own=pixelVelocity(v);
  let ownAngle=atan2(own.y,own.x);let ownLength=length(own);
  let lengthDiff=abs(hole.y-ownLength)-2.0;
  var angleDiff=abs(ownAngle-hole.x);angleDiff=min(angleDiff,TWO_PI-angleDiff);
  let polar=min(saturate(1.0+${wgslF32(1 / 32)}-lengthDiff),saturate(2.0-angleDiff/HOLE_FILL_ANGLE_STEP));
  let cartesian=saturate(1.0+HOLE_FILL_ANGLE_STEP*ownLength-length(fillVelocity-own));
  mask=max(mask,mix(cartesian,polar,saturate(min(hole.y,ownLength)-2.0)));
 }
 return TaaParallax(!offScreen&&mask<0.5,fillVelocity,anyValid&&encodable);
}`
