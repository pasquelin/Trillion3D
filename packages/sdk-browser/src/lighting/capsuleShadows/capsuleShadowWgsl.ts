import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { fastAcos } from '../../../../math/src/wgsl/geometry.ts'
import { meshFieldWgsl } from '../distanceField/meshFieldWgsl.ts'
import type { CapsuleHooks } from './hooks.ts'
import { FLOAT32_MAX } from '../../../../math/src/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  CAPSULE_BINDINGS,
  CAPSULE_BENT_NORMAL_FORMAT,
  CAPSULE_FACTORS_FORMAT,
  CAPSULE_SKY_DEPTH,
  CAPSULE_TILE,
  CAPSULE_TILE_CASTERS,
  CAPSULE_TILE_SHAPES,
} from './layout.ts'

/**
 * THE CAPSULE SHADOW PROGRAM: for each pixel of the shadow factors, how much of a light, or of the sky and the indirect light, the
 * spheres and capsules around it let through.
 *
 * A workgroup is a tile of `CAPSULE_TILE` pixels a side. It finds the depth span of its pixels, in two groups (the nearer half of the span
 * and the farther half), bounds each group by a sphere, and keeps the shapes whose reach meets that sphere and, for a punctual light, the cone
 * from the sphere toward the light, in shared memory. Each pixel then traces a cone toward the light through the kept shapes of its group:
 * each shape is replaced by the sphere that best stands for it along the ray (the sphere nearest the ray's direction, or, for the indirect
 * kinds, the capsule scaled to a sphere), and the share of the light's cone the sphere's cone covers darkens the pixel; the shapes' shadows
 * multiply. The tile's number of kept shapes is written out for the upsample, which draws only tiles that meet a shape.
 *
 * The program has four modes (`CapsuleMode`): a directional light, a point light, the indirect light (each shape carries the direction and angle
 * of the light, `capsuleLights`), and the movable sky light, which takes the receiver's bent normal and writes it back darkened.
 * The scene's depth is the host's: it defines `capsuleSceneDepth(pixel)` (the linear depth of the view, positive, in metres) and, for the indirect
 * kinds, `capsuleCastsIndirect(pixel)` (whether the pixel is of an object that casts an indirect capsule shadow).
 *
 * The reference's code has faults this program does not carry. The tile's bounding spheres are worked out from the four corners of the tile
 * (the reference flips the vertical axis of the lower corner and so takes the vertical extent at the nearer depth alone, and measures the
 * radius of the farther group from the corner of the nearer one); its tiles are the exact pixels the workgroup covers (the reference splits the
 * rectangle in as many equal parts as there are tiles, which drift from the pixels' by up to a tile at the far edge); the sky is skipped pixel
 * by pixel (the reference skips it by tile, so a tile on the sky's edge shades the sky); a capsule along the ray no longer divides by zero,
 * and a shape of radius zero casts nothing.
 */

/** The four ways a pass reads its light. */
export type CapsuleMode = 'directional' | 'point' | 'indirect' | 'skylight'

/** The angle, in radians, of a tangent of at least 0 (an odd polynomial of degree five below 1, the complement of the same polynomial of the inverse above). */
const capsuleAtan = wgslFn(
  'capsuleAtan',
  [PI],
  `fn capsuleAtan(x:f32)->f32{
 let small=x<1.0;
 let t=select(1.0/x,x,small);
 let t2=t*t;
 let poly=((0.0872929*t2-0.301895)*t2+1.0)*t;
 return select(0.5*PI-poly,poly,small);
}`,
)

/** The orthonormal pair across a unit axis. */
const capsuleFrame = wgslFn(
  'capsuleFrame',
  [],
  `fn capsuleFrame(z:vec3f)->mat2x3f{
 var x:vec3f;
 if(abs(z.x)>abs(z.y)){
  let inverse=1.0/sqrt(dot(z.xz,z.xz));
  x=vec3f(-z.z*inverse,0.0,z.x*inverse);
 }else{
  let inverse=1.0/sqrt(dot(z.yz,z.yz));
  x=vec3f(0.0,z.z*inverse,-z.y*inverse);
 }
 return mat2x3f(x,cross(z,x));
}`,
)

/** Whether two spheres (centre and radius) overlap. */
const capsuleSpheresMeet = wgslFn(
  'capsuleSpheresMeet',
  [],
  `fn capsuleSpheresMeet(a:vec4f,b:vec4f)->bool{
 let radii=a.w+b.w;
 let between=a.xyz-b.xyz;
 return dot(between,between)<radii*radii;
}`,
)

/** Whether a sphere meets a cone (its vertex, unit axis, cosine and sine) within `reach` along the axis. */
const capsuleSphereCone = wgslFn(
  'capsuleSphereCone',
  [],
  `fn capsuleSphereCone(sphere:vec4f,vertex:vec3f,axis:vec3f,cosCone:f32,sinCone:f32,reach:f32)->bool{
 let apex=vertex-(sphere.w/sinCone)*axis;
 var d=sphere.xyz-apex;
 var lengthSquared=dot(d,d);
 var e=dot(axis,d);
 if(!(e>0.0&&e*e>=lengthSquared*cosCone*cosCone)){return false;}
 d=sphere.xyz-vertex;
 lengthSquared=dot(d,d);
 e=-dot(axis,d);
 if(e>0.0&&e*e>=lengthSquared*sinCone*sinCone){
  if(lengthSquared>sphere.w*sphere.w){return false;}
 }
 return dot(sphere.xyz-vertex,axis)-sphere.w<reach;
}`,
)

/** The area of the overlap of two spherical caps (radii in radians, distance between centres in radians). */
const capsuleCapArea = wgslFn(
  'capsuleCapArea',
  [],
  `fn capsuleCapArea(radius0:f32,radius1:f32,distance:f32)->f32{
 let smaller=min(radius0,radius1);
 let whole=6.283185308-6.283185308*cos(smaller);
 if(distance<=max(radius0,radius1)-smaller){return whole;}
 if(distance>=radius0+radius1){return 0.0;}
 let difference=abs(radius0-radius1);
 return smoothstep(0.0,1.0,1.0-saturate((distance-difference)/(radius0+radius1-difference)))*whole;
}`,
)

const modeFlags = (mode: CapsuleMode) => ({
  point: mode === 'point',
  punctual: mode === 'directional' || mode === 'point',
  fromCapsule: mode === 'indirect' || mode === 'skylight',
  bent: mode === 'skylight',
})

const B = CAPSULE_BINDINGS
const SKY = wgslF32(CAPSULE_SKY_DEPTH)

/** The declarations of the pass's data. */
const dataWgsl = (mode: CapsuleMode, casters: boolean) => {
  const { fromCapsule, bent } = modeFlags(mode)
  return `struct CapsuleShape{center:vec3f,radius:f32,orientation:vec3f,length:f32,}
struct CapsuleParams{
 clipToView:mat4x4f,
 viewToWorld:mat4x4f,
 lightPosition:vec4f,
 lightAim:vec4f,
 viewport:vec4f,
 scissor:vec4f,
 shape:vec4f,
 fade:vec4f,
 extra:vec4f,
 depth:vec4f,
 translation:vec4f,
}
@group(0) @binding(${B.params}) var<uniform> capsuleParams:CapsuleParams;
@group(0) @binding(${B.shapes}) var<storage,read> capsuleShapes:array<CapsuleShape>;${
    fromCapsule
      ? `\n@group(0) @binding(${B.lightData}) var<storage,read> capsuleLights:array<vec4u>;`
      : ''
  }${
    bent
      ? `\n@group(0) @binding(${B.receiverBentNormal}) var capsuleReceiver:texture_2d<f32>;\n@group(0) @binding(${B.bentNormal}) var capsuleBent:texture_storage_2d<${CAPSULE_BENT_NORMAL_FORMAT},write>;`
      : `\n@group(0) @binding(${B.tileCounts}) var<storage,read_write> capsuleTileCounts:array<u32>;\n@group(0) @binding(${B.factors}) var capsuleFactors:texture_storage_2d<${CAPSULE_FACTORS_FORMAT},write>;`
  }
${
  casters
    ? `\n@group(0) @binding(${B.casterIndices}) var<storage,read> capsuleCasterIndices:array<u32>;\nconst CAPSULE_TILE_CASTERS:u32=${CAPSULE_TILE_CASTERS}u;\nvar<workgroup> tileCasterCount:array<atomic<u32>,2>;\nvar<workgroup> tileCasters:array<u32,${2 * CAPSULE_TILE_CASTERS}>;`
    : ''
}
const CAPSULE_TILE_SHAPES:u32=${CAPSULE_TILE_SHAPES}u;
var<workgroup> tileMinZ:atomic<u32>;
var<workgroup> tileMaxZ:atomic<u32>;
var<workgroup> tileMinZ2:atomic<u32>;
var<workgroup> tileMaxZ2:atomic<u32>;
var<workgroup> tileCount:array<atomic<u32>,2>;
var<workgroup> tileShapes:array<u32,${2 * CAPSULE_TILE_SHAPES}>;`
}

/** The view's reading of a pixel: its place on the screen, and its place in the translated world at a depth. */
const VIEW_WGSL = `
fn capsulePixelNdc(pixel:vec2f)->vec2f{
 let v=capsuleParams.viewport;
 return vec2f(2.0*(pixel.x-v.x)/v.z-1.0,1.0-2.0*(pixel.y-v.y)/v.w);
}
fn capsuleViewXY(ndc:vec2f,depth:f32)->vec2f{
 let p=capsuleParams.clipToView*vec4f(ndc,0.5,1.0);
 if(capsuleParams.extra.w<0.5){return p.xy/p.w;}
 let v=p.xyz/p.w;
 return v.xy/(-v.z)*depth;
}
fn capsuleTranslated(ndc:vec2f,depth:f32)->vec3f{
 return (capsuleParams.viewToWorld*vec4f(capsuleViewXY(ndc,depth),-depth,1.0)).xyz;
}
// The sphere that bounds a tile between two depths: its centre in the translated world and its radius.
fn capsuleTileSphere(group:vec2u,near:f32,far:f32)->vec4f{
 let side=${CAPSULE_TILE}.0*capsuleParams.shape.z;
 let first=capsuleParams.scissor.xy+vec2f(group)*side;
 let a=capsulePixelNdc(first);
 let b=capsulePixelNdc(first+vec2f(side));
 var lo=vec3f(1.0e30);
 var hi=vec3f(-1.0e30);
 for(var corner=0u;corner<4u;corner++){
  let ndc=vec2f(select(a.x,b.x,(corner&1u)==1u),select(a.y,b.y,(corner&2u)==2u));
  for(var end=0u;end<2u;end++){
   let depth=select(near,far,end==1u);
   let p=vec3f(capsuleViewXY(ndc,depth),-depth);
   lo=min(lo,p);
   hi=max(hi,p);
  }
 }
 let centre=(lo+hi)*0.5;
 return vec4f((capsuleParams.viewToWorld*vec4f(centre,1.0)).xyz,length(centre-hi));
}`

/** The cone a tile's group looks at the light through, for a punctual light: its axis, cosine and sine. */
const coneWgsl = (point: boolean) => `
struct CapsuleCone{axis:vec3f,cosine:f32,sine:f32,}
fn capsuleCone(sphere:vec4f)->CapsuleCone{
${
  point
    ? ` let toLight=capsuleParams.lightPosition.xyz-sphere.xyz;
 let distance=length(toLight);
 let tangent=capsuleParams.shape.x/distance;
 let cosine=1.0/sqrt(1.0+tangent*tangent);
 return CapsuleCone(toLight/distance,cosine,cosine*tangent);`
    : ` return CapsuleCone(capsuleParams.lightAim.xyz,cos(capsuleParams.lightAim.w),sin(capsuleParams.lightAim.w));`
}
}`

/** The light of a shape of the indirect kinds, and the fade of its radius where the light comes from above (the scene's up is y). */
const LIGHT_DATA_WGSL = `
struct CapsuleLightData{direction:vec3f,angle:f32,minVisibility:f32,}
fn capsuleLightData(index:u32)->CapsuleLightData{
 let record=capsuleLights[index];
 let halves=unpack2x16float(record.w);
 return CapsuleLightData(bitcast<vec3f>(record.xyz),halves.x,halves.y);
}
fn capsuleFadedRadius(radius:f32,direction:vec3f)->f32{
 return radius*(1.0-saturate(2.0*(-direction.y-capsuleParams.fade.x)*capsuleParams.fade.y));
}`

/** Whether a shape can shade the pixels of a group, by its sphere and its cone toward the light. */
const cullWgsl = (mode: CapsuleMode) => {
  const { punctual, fromCapsule } = modeFlags(mode)
  return `
fn capsuleCulls(shape:CapsuleShape,tile:vec4f,axis:vec3f,cosCone:f32,sinCone:f32,reach:f32)->bool{
${
  fromCapsule
    ? ` let zAxis=shape.orientation;
 let frame=capsuleFrame(zAxis);
 let zScaled=zAxis*(shape.radius/(0.5*shape.length+shape.radius));
 let toTile=tile.xyz-shape.center;
 let centre=vec3f(dot(toTile,frame[0]),dot(toTile,frame[1]),dot(toTile,zScaled));
 let coneAxis=normalize(vec3f(dot(axis,frame[0]),dot(axis,frame[1]),dot(axis,zScaled)));
 let radius=shape.radius;
 let shapeCentre=vec3f(0.0);`
    : ` let centre=tile.xyz;
 let coneAxis=axis;
 let radius=shape.radius+0.5*shape.length;
 let shapeCentre=shape.center;`
}
 return capsuleSpheresMeet(vec4f(shapeCentre,radius+reach),vec4f(centre,tile.w))
  &&capsuleSphereCone(vec4f(shapeCentre,radius+tile.w),centre,coneAxis,cosCone,sinCone,reach);
}
fn capsuleCull(index:u32,tile0:vec4f,tile1:vec4f,count:u32,reach:f32){
${punctual ? ' let cone0=capsuleCone(tile0);\n let cone1=capsuleCone(tile1);\n' : ''} for(var shape=index;shape<count;shape+=${CAPSULE_TILE * CAPSULE_TILE}u){
${
  punctual
    ? `  let axis0=cone0.axis;let cos0=cone0.cosine;let sin0=cone0.sine;
  let axis1=cone1.axis;let cos1=cone1.cosine;let sin1=cone1.sine;`
    : `  let light=capsuleLightData(shape);
  let axis0=light.direction;let cos0=cos(light.angle);let sin0=sin(light.angle);
  let axis1=axis0;let cos1=cos0;let sin1=sin0;`
}
  let item=capsuleShapes[shape];
  if(capsuleCulls(item,tile0,axis0,cos0,sin0,reach)){
   let at=min(atomicAdd(&tileCount[0],1u),CAPSULE_TILE_SHAPES-1u);
   tileShapes[at]=shape;
  }
  if(capsuleCulls(item,tile1,axis1,cos1,sin1,reach)){
   let at=min(atomicAdd(&tileCount[1],1u),CAPSULE_TILE_SHAPES-1u);
   tileShapes[CAPSULE_TILE_SHAPES+at]=shape;
  }
 }
}`
}

/** The loop's head: the light of a shape of the indirect kinds replaces the pixel's, and the shape's radius fades with it. */
const traceHeadText = (fromCapsule: boolean) => `
fn capsuleTrace(rayStart:vec3f,rayDirection:vec3f,lightDistance:f32,lightAngle:f32,reach:f32,group:u32,count:u32)->f32{
 var visibility=1.0;
 var unitRay=rayDirection;
 var angle=lightAngle;
 var areaOfLight=6.283185308-6.283185308*cos(angle);
 for(var kept=0u;kept<count;kept++){
  let index=tileShapes[CAPSULE_TILE_SHAPES*group+kept];
  var minVisibility=0.0;
${
  fromCapsule
    ? `  let light=capsuleLightData(index);
  unitRay=light.direction;
  angle=light.angle;
  minVisibility=light.minVisibility;
  areaOfLight=6.283185308-6.283185308*cos(angle);`
    : ''
}
  var shape=capsuleShapes[index];
${fromCapsule ? '  shape.radius=capsuleFadedRadius(shape.radius,unitRay);\n' : ''}  if(!(shape.radius>0.0)){continue;}
  var distanceToSphere:f32;
  var towardSphere:vec3f;
  var rayInShapeSpace=unitRay;
  if(shape.length>0.0){
`

/** A capsule's sphere, found by the shape scaled to a sphere (the indirect kinds) or by the sphere nearest the ray (the lights'). */
const traceSphereText = (fromCapsule: boolean) =>
  fromCapsule
    ? `   let frame=capsuleFrame(shape.orientation);
   let zScaled=shape.orientation*(shape.radius/(0.5*shape.length+shape.radius));
   let toStart=rayStart-shape.center;
   let local=vec3f(dot(toStart,frame[0]),dot(toStart,frame[1]),dot(toStart,zScaled));
   distanceToSphere=length(local);
   towardSphere=-local/distanceToSphere;
   rayInShapeSpace=normalize(vec3f(dot(unitRay,frame[0]),dot(unitRay,frame[1]),dot(unitRay,zScaled)));`
    : `   let toCentre=shape.center-rayStart;
   let span=shape.orientation*shape.length;
   let end0=toCentre-0.5*span;
   let end1=toCentre+0.5*span;
   let along=dot(unitRay,span);
   let across=along*unitRay-span;
   let acrossSquared=shape.length*shape.length-along*along;
   let t=select(0.0,saturate(dot(end0,across)/acrossSquared),acrossSquared>1.0e-6*shape.length*shape.length);
   let toSphere=end0+t*span;
   distanceToSphere=min(min(length(toSphere),length(end0)),length(end1));
   towardSphere=toSphere/length(toSphere);`

/** The cone of the shape against the light's: the share of the light it covers, faded with the distance, and the shadow it multiplies in. */
const traceConeText = (point: boolean, fromCapsule: boolean) => `
  }else{
   let toCentre=shape.center-rayStart;
   distanceToSphere=length(toCentre);
   towardSphere=toCentre/distanceToSphere;
  }
  let between=fastAcos(dot(towardSphere,rayInShapeSpace));
  var overlap=capsuleCapArea(angle,capsuleAtan(shape.radius/distanceToSphere),between);
${
  point
    ? '  overlap=mix(overlap,0.0,saturate((distanceToSphere-lightDistance+shape.radius)/shape.radius));'
    : ''
}
  var cone=1.0-saturate(overlap/areaOfLight);
  cone=mix(cone,1.0,saturate(distanceToSphere/reach*3.0-2.0));
${fromCapsule ? '  cone=mix(minVisibility,1.0,cone);\n' : ''}  visibility*=cone;
 }
 return visibility;
}`

/** The trace of a cone from a pixel toward the light through the shapes the tile kept for the pixel's group. */
const traceWgsl = (mode: CapsuleMode) => {
  const { point, fromCapsule } = modeFlags(mode)
  return `${traceHeadText(fromCapsule)}${traceSphereText(fromCapsule)}${traceConeText(point, fromCapsule)}`
}

/** The meshes with a distance field that cast the indirect shadow: the tile keeps those whose bounds, and whose field at the tile's centre, reach
 *  it, and a pixel traces a cone through each one's field, the shadows combined by a geometric mean weighted by how near the pixel is to each
 *  mesh. The fields are in centimetres (`meshFieldWgsl`); the rest of the program is in metres. */
const CASTERS_WGSL = `
fn capsuleCasterTouches(object:u32,bounds:DfObjectBounds,tile:vec4f,reachCm:f32)->bool{
 let translation=DfVec3(capsuleParams.translation.xyz*100.0,vec3f(0.0));
 let centre=dfToTranslated(bounds.center,translation);
 let sphere=tile*100.0;
 if(!capsuleSpheresMeet(vec4f(centre,bounds.sphereRadius+reachCm),sphere)){return false;}
 let data=loadDfObjectData(object);
 let volume=dfWorldToVolume(data,DfVec3(sphere.xyz-translation.hi,vec3f(0.0)));
 let clamped=clamp(volume,-data.extent,data.extent);
 let worldDistance=(distanceToMeshSurfaceStandalone(clamped,data)+length(clamped-volume))*data.volumeScale;
 return worldDistance-sphere.w<reachCm*1.1;
}
fn capsuleCullCasters(index:u32,tile0:vec4f,tile1:vec4f,count:u32,reach:f32){
 for(var listed=index;listed<count;listed+=${CAPSULE_TILE * CAPSULE_TILE}u){
  let object=capsuleCasterIndices[listed];
  let bounds=loadDfObjectBounds(object);
  let effective=reach*100.0+0.5*bounds.sphereRadius;
  if(capsuleCasterTouches(object,bounds,tile0,effective)){
   let at=min(atomicAdd(&tileCasterCount[0],1u),CAPSULE_TILE_CASTERS-1u);
   tileCasters[at]=listed;
  }
  if(capsuleCasterTouches(object,bounds,tile1,effective)){
   let at=min(atomicAdd(&tileCasterCount[1],1u),CAPSULE_TILE_CASTERS-1u);
   tileCasters[CAPSULE_TILE_CASTERS+at]=listed;
  }
 }
}
fn capsuleTraceCasters(start:vec3f,reach:f32,group:u32,count:u32)->f32{
 var numerator=0.0;
 var total=0.0;
 let startCm=(start-capsuleParams.translation.xyz)*100.0;
 for(var kept=0u;kept<count;kept++){
  let listed=tileCasters[CAPSULE_TILE_CASTERS*group+kept];
  let light=capsuleLightData(u32(capsuleParams.shape.w)+listed);
  let tanCone=tan(light.angle);
  let object=capsuleCasterIndices[listed];
  let bounds=loadDfObjectBounds(object);
  let data=loadDfObjectData(object);
  let effective=reach*100.0+0.5*bounds.sphereRadius;
  let volumeStart=dfWorldToVolume(data,DfVec3(startCm,vec3f(0.0)));
  let volumeEnd=dfWorldToVolume(data,DfVec3(startCm+light.direction*effective,vec3f(0.0)));
  var volumeRay=volumeEnd-volumeStart;
  let rayLength=length(volumeRay);
  volumeRay/=rayLength;
  let asset=dfAssetMip(data.asset,dfAssetMip(data.asset,0u).numMips-1u);
  let maxEncoded=asset.scaleBias.x+asset.scaleBias.y;
  let maxSphere=min(tanCone*effective/data.volumeScale,maxEncoded);
  var minTrace=1.0;
  var time=0.02;
  for(var iteration=0u;iteration<32u;iteration++){
   let position=volumeStart+volumeRay*time;
   let clamped=clamp(position,-data.extent,data.extent);
   let field=sampleSparseMeshSdf(clamped,asset)+length(clamped-position);
   let sphere=clamp(tanCone*time,0.0,maxSphere);
   var visible=pow(saturate(field/sphere),0.8);
   visible=max(visible,saturate((time+field)*data.volumeScale/effective));
   minTrace=min(minTrace,visible);
   time+=max(min(field,visible*0.1*rayLength),1.0/128.0);
   if(field<=0.0||time>rayLength){break;}
  }
  let minVisibility=light.minVisibility*light.minVisibility;
  minTrace=mix(minVisibility,1.0,minTrace);
  let startClamped=clamp(volumeStart,-data.extent,data.extent);
  let weightDistance=(sampleSparseMeshSdf(startClamped,asset)+length(startClamped-volumeStart))*data.volumeScale;
  let weight=pow(1.0-saturate(weightDistance/effective),4.0);
  if(weight>0.0){
   numerator+=weight*log2(minTrace);
   total+=weight;
  }
 }
 return select(1.0,exp2(numerator/total),total>0.0);
}`

/** The entry's head: the pixel, its depth, and the tile's shared state cleared by the first thread. */
const entryHeadText = (casters: boolean) => `
@compute @workgroup_size(${CAPSULE_TILE},${CAPSULE_TILE},1)
fn capsuleShadow(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) index:u32){
 let downsample=u32(capsuleParams.shape.z);
 let pixel=vec2i(id.xy*downsample+vec2u(capsuleParams.scissor.xy));
 let depth=capsuleSceneDepth(pixel);
 if(index==0u){
  atomicStore(&tileMinZ,0x7F7FFFFFu);
  atomicStore(&tileMaxZ,0u);
  atomicStore(&tileMinZ2,0x7F7FFFFFu);
  atomicStore(&tileMaxZ2,0u);
  atomicStore(&tileCount[0],0u);
  atomicStore(&tileCount[1],0u);${casters ? '\n  atomicStore(&tileCasterCount[0],0u);\n  atomicStore(&tileCasterCount[1],0u);' : ''}
 }
`

/** The tile's depth bounds in two groups, by atomics over the workgroup, and the two spheres that bound the groups; a point light's tile out of its reach is off. */
const entryBoundsText = (point: boolean) => ` workgroupBarrier();
 let counted=depth<${SKY};
 if(counted){
  atomicMin(&tileMinZ,bitcast<u32>(depth));
  atomicMax(&tileMaxZ,bitcast<u32>(depth));
 }
 workgroupBarrier();
 let minZ=bitcast<f32>(atomicLoad(&tileMinZ));
 let maxZ=bitcast<f32>(atomicLoad(&tileMaxZ));
 let halfZ=0.5*(minZ+maxZ);
 if(counted){
  if(depth>=halfZ){atomicMin(&tileMinZ2,bitcast<u32>(depth));}
  if(depth<=halfZ){atomicMax(&tileMaxZ2,bitcast<u32>(depth));}
 }
 workgroupBarrier();
 let minZ2=bitcast<f32>(atomicLoad(&tileMinZ2));
 let maxZ2=bitcast<f32>(atomicLoad(&tileMaxZ2));
 var tileOn=!(atomicLoad(&tileMinZ)==0x7F7FFFFFu&&atomicLoad(&tileMaxZ)==0u);
 let tile0=capsuleTileSphere(group.xy,minZ,maxZ2);
 let tile1=capsuleTileSphere(group.xy,minZ2,maxZ);
${
  point
    ? ` let reachOfLight=1.0/capsuleParams.lightPosition.w;
 tileOn=tileOn&&(length(capsuleParams.lightPosition.xyz-tile0.xyz)<reachOfLight+tile0.w||length(capsuleParams.lightPosition.xyz-tile1.xyz)<reachOfLight+tile1.w);
`
    : ''
}`

/** The tile's culling of the shapes (and of the casters), and the group the pixel belongs to. */
const entryCullText = (casters: boolean) => `
 let count=select(0u,u32(capsuleParams.shape.w),tileOn);
 capsuleCull(index,tile0,tile1,count,capsuleParams.shape.y);${
   casters
     ? '\n capsuleCullCasters(index,tile0,tile1,select(0u,u32(capsuleParams.fade.z),tileOn),capsuleParams.shape.y);'
     : ''
 }
 workgroupBarrier();
 let tileGroup=select(0u,1u,depth>maxZ2);
 let kept=min(atomicLoad(&tileCount[tileGroup]),CAPSULE_TILE_SHAPES);${casters ? '\n let keptCasters=min(atomicLoad(&tileCasterCount[tileGroup]),CAPSULE_TILE_CASTERS);' : ''}
`

/** Where the pixel's ray starts and which way it goes, by the kind of light. */
const rayText = (mode: CapsuleMode) => {
  const { point, punctual } = modeFlags(mode)
  return point
    ? `  let toLight=capsuleParams.lightPosition.xyz-surface;
  let lightDistance=length(toLight);
  let rayDirection=toLight/lightDistance;
  let lightAngle=capsuleAtan(capsuleParams.shape.x/lightDistance);`
    : punctual
      ? `  let lightDistance=0.0;
  let rayDirection=capsuleParams.lightAim.xyz;
  let lightAngle=capsuleParams.lightAim.w;`
      : `  let lightDistance=0.0;
  let rayDirection=vec3f(0.0);
  let lightAngle=0.0;`
}

/** The pixel's trace through the kept shapes (and casters) of its group. */
const entryTraceText = (mode: CapsuleMode, casters: boolean) => ` var visibility=1.0;
 if(tileOn&&counted){
  let surface=capsuleTranslated(capsulePixelNdc(vec2f(pixel)+0.5),depth);
${rayText(mode)}
  visibility=capsuleTrace(surface,rayDirection,lightDistance,lightAngle,capsuleParams.shape.y,tileGroup,kept);${
    casters
      ? '\n  visibility*=capsuleTraceCasters(surface,capsuleParams.shape.y,tileGroup,keptCasters);'
      : ''
  }
 }
`

/** The pixel's write: the tile's count (the lights' kinds), and the factor or the darkened bent normal. */
const entryWriteText = (bent: boolean, casters: boolean) => `${
  bent
    ? ''
    : ` if(tileOn&&index==0u&&all(group.xy<vec2u(capsuleParams.extra.xy))){
  capsuleTileCounts[group.y*u32(capsuleParams.extra.x)+group.x]=atomicLoad(&tileCount[0])+atomicLoad(&tileCount[1])${
    casters ? '+atomicLoad(&tileCasterCount[0])+atomicLoad(&tileCasterCount[1])' : ''
  };
 }
`
}${
  bent
    ? ` if(capsuleParams.extra.z<1.0){
  visibility=mix(1.0,visibility,select(1.0,capsuleParams.extra.z,capsuleCastsIndirect(pixel)));
 }
`
    : ''
}${
  bent
    ? ` let receiver=textureLoad(capsuleReceiver,vec2i(id.xy),0).xyz;
 if(all(id.xy<textureDimensions(capsuleBent))){
  textureStore(capsuleBent,id.xy,vec4f(receiver*visibility,min(depth,65500.0)));
 }`
    : ` if(all(id.xy<textureDimensions(capsuleFactors))){
  textureStore(capsuleFactors,id.xy,vec4f(visibility,select(${wgslF32(FLOAT32_MAX)},depth,counted),0.0,0.0));
 }`
}
}`

/** The entry: the tile's bounds, its culling, then each pixel's trace and its write. */
const mainWgsl = (mode: CapsuleMode, casters: boolean) => {
  const { point, bent } = modeFlags(mode)
  return `${entryHeadText(casters)}${entryBoundsText(point)}${entryCullText(casters)}${entryTraceText(mode, casters)}${entryWriteText(bent, casters)}`
}

/** The program of a mode, over the frame's reading (`hooks`). `casters` adds the meshes with a distance field to the indirect kind; the distance fields' scene
 *  (`meshFieldWgsl`) is then group 1 from binding 0. */
export function capsuleShadowShader(mode: CapsuleMode, hooks: CapsuleHooks, casters = false) {
  const { punctual, fromCapsule } = modeFlags(mode)
  if (casters && mode !== 'indirect')
    throw new RangeError('only the indirect shadow traces distance-field casters')
  const own = [
    dataWgsl(mode, casters),
    hooks.text,
    VIEW_WGSL,
    punctual ? coneWgsl(mode === 'point') : '',
    fromCapsule ? LIGHT_DATA_WGSL : '',
    cullWgsl(mode),
    traceWgsl(mode),
    casters ? CASTERS_WGSL : '',
    mainWgsl(mode, casters),
  ].join('\n')
  const uses = [
    capsuleAtan,
    capsuleFrame,
    capsuleSpheresMeet,
    capsuleSphereCone,
    capsuleCapArea,
    fastAcos,
    ...hooks.uses,
    ...(casters ? [meshFieldWgsl(1, 0)] : []),
  ]
  return wgslProgram(own, uses)
}
