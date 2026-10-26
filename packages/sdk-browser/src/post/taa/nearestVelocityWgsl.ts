import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { INVERSE_TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import {
  FUSED_FLATTEN_SLOTS,
  STILL_MOTION_WGSL,
  flatTexel,
  flattenOutputs,
  flattenParams,
  flattenReduction,
} from '../effects/motionBlur/flattenWgsl.ts'
import { FLATTEN_TILE, type BlurVariant } from '../effects/motionBlur/motionBlurLayout.ts'
import { wpoGraphWgsl } from '../../visibility/shader/wpoGraphWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { NEAREST_SURFACE_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { FIELD_FORMAT, REPROJECTION_FIELD_WGSL } from './reprojectionFieldWgsl.ts'
import { SPATIAL_BROWSE_WGSL } from './spatialAntiAliasingWgsl.ts'
import {
  CLOSEST_FORMAT,
  HOLE_FILL_WGSL,
  MARKS_FORMAT,
  OCCLUDER_WORD_WGSL,
  PIXEL_ANIMATED,
  PIXEL_RESTARTS,
  RESTART_MARK,
  TEXEL_TILE,
} from './velocityWgsl.ts'
import { MARKED_RESPONSIVE_WGSL } from '../../visibility/types.ts'

/** The quantisation of a scattered occluder's bilinear weight: a tap of no 63rd scatters none. */
const SCATTER_WEIGHT_STEPS = 63
/** The nearest velocity pass's bindings: its inputs (`VELOCITY_INPUT_BINDINGS`), then its outputs,
 *  and the velocity stage's vectors it dilates (`vectors`, read for the neighbourhood's motion and
 *  the pixel's flags), the responsiveness the layers over the pixel carry (`responsive`), the
 *  reprojection field's words it writes (`jacobian`, `boundary`). */
export const VELOCITY_BINDINGS = {
  ...VELOCITY_INPUT_BINDINGS,
  closest: 10,
  marks: 11,
  occluders: 12,
  vectors: 20,
  jacobian: 21,
  boundary: 22,
  responsive: 23,
} as const

/** The iterations of the depth browse that finds a reprojection boundary: three samples a side. */
const BOUNDARY_ITERATIONS = 3

/** The texel helpers of the nearest velocity beyond its surface: the depth error, whether a texel
 *  moves, and the scatter of the occluders. */
const VELOCITY_HELPERS_WGSL = wgslBlock(
  'VELOCITY_HELPERS_WGSL',
  [
    NEAREST_SURFACE_WGSL,
    HOLE_FILL_WGSL,
    OCCLUDER_WORD_WGSL,
    REPROJECTION_FIELD_WGSL,
    SPATIAL_BROWSE_WGSL,
    safeRcp,
    ndcToPixel,
  ],
  `fn depthBilateralError(n:array<f32,9>)->f32{
 return depthBilaterals(n,vec2i(1,0),vec2i(0,1)).error;
}
struct TaaBilateral{weights:vec4f,error:f32,success:bool}
/** The depth steps of the 3×3 along two orthogonal directions \`e\` and \`s\`, each neighbour
 *  weighed by how far it continues the surface (E, W, S, N in the weights), the pair of each axis
 *  to one; the depth error they leave, and whether either axis found a neighbour to weigh. */
fn depthBilaterals(n:array<f32,9>,e:vec2i,s:vec2i)->TaaBilateral{
 var t=n;
 let c=t[4];
 let zE=t[4+e.x+3*e.y];let zW=t[4-e.x-3*e.y];let zS=t[4+s.x+3*s.y];let zN=t[4-s.x-3*s.y];
 let variationEW=abs(c-(zE+zW)*0.5);let variationSN=abs(c-(zS+zN)*0.5);
 let dE=abs(zE-c);let dW=abs(zW-c);let dS=abs(zS-c);let dN=abs(zN-c);
 let minE=min(abs(zE-zW),min(dE,dW));let minS=min(abs(zS-zN),min(dS,dN));
 let pixelError=pixelDeviceZError(c)*length(vec2f(e));
 let finalE=max(min(max(minE,pixelError),max(minS,8.0*pixelError)),1e-30);
 let finalS=max(min(max(minS,pixelError),max(minE,8.0*pixelError)),1e-30);
 var wE=saturate(1.5-min(dE,variationEW)/finalE);var wW=saturate(1.5-min(dW,variationEW)/finalE);
 var wS=saturate(1.5-min(dS,variationSN)/finalS);var wN=saturate(1.5-min(dN,variationSN)/finalS);
 let tEW=wE+wW;let tSN=wS+wN;
 let iEW=safeRcp(tEW);let iSN=safeRcp(tSN);
 wE*=iEW;wW*=iEW;wS*=iSN;wN*=iSN;
 return TaaBilateral(vec4f(wE,wW,wS,wN),max(dE*wE+dW*wW,dS*wS+dN*wN),tEW>0.0||tSN>0.0);
}
struct TaaFieldJacobian{jacobian:TaaJacobian,error:f32}
/** The jacobian of the reprojection at the texel and the parallax depth error, from the 3×3's depths
 *  \`z\` and velocities \`v\`, in render pixels: each axis the weighed steps to the neighbours on its
 *  two sides, the horizontal and vertical neighbours first, the diagonal ones, turned back to the
 *  axes, where those found none to weigh. */
fn reprojectionJacobian(z:array<f32,9>,v:array<vec2f,9>)->TaaFieldJacobian{
 var t=v;
 let cardinal=depthBilaterals(z,vec2i(1,0),vec2i(0,1));
 var j0=(t[5]-t[4])*cardinal.weights.x+(t[4]-t[3])*cardinal.weights.y;
 var j1=(t[7]-t[4])*cardinal.weights.z+(t[4]-t[1])*cardinal.weights.w;
 var error=cardinal.error;
 if(!cardinal.success){
  let diagonal=depthBilaterals(z,vec2i(1,1),vec2i(-1,1));
  let se=(t[8]-t[4])*diagonal.weights.x+(t[4]-t[0])*diagonal.weights.y;
  let sw=(t[6]-t[4])*diagonal.weights.z+(t[4]-t[2])*diagonal.weights.w;
  j0=se*0.5-sw*0.5;j1=se*0.5+sw*0.5;
  error=diagonal.error;
 }
 return TaaFieldJacobian(TaaJacobian(j0,j1),error);
}
/** A depth sample half a texel toward \`side\` of texel \`p\`: the mean of the two texels. */
fn edgeDepth(p:vec2i,side:vec2i)->f32{
 return 0.5*(textureLoad(depth,clampTexel(p),0)+textureLoad(depth,clampTexel(p+side),0));
}
/** The boundary a texel's reprojection stops at (\`encodeReprojectionBoundary\`): where the texel's
 *  vector differs from its dilated one by more than the field's speed and the dilated one stays on
 *  screen, the depth's edge is browsed (\`findBrowsing\`) \`${BOUNDARY_ITERATIONS}\` samples each way, each
 *  half a texel toward the edge, stopping at the first that leaves the edge's mid band; the two
 *  lengths and how each stopped give the edge's distance and slope, and the point of the texel from
 *  which its neighbour's vector is not to be used. Else the whole texel is dilated, boundary (0, 1). */
fn reprojectionBoundary(p:vec2i,own:vec2f,dilated:vec2f,z:array<f32,9>)->vec2f{
 let prevScreen=screenOfTexel(p)-dilated;
 let apart=view.render.xy*(own-dilated);
 if(dot(apart,apart)<=view.fraction.z||any(abs(prevScreen)>vec2f(1.0))){return vec2f(0.0,1.0);}
 var t=z;
 let c=t[4];
 let found=findBrowsing(c,t[1],t[7],t[5],t[3],t[2],t[0],t[8],t[6]);
 let browse=vec2i(found.browse);let side=vec2i(found.side);
 let merged=0.5*(found.edge+c);let band=0.25*abs(found.edge-c);
 let minDepth=merged-band;let maxDepth=merged+band;
 var minP=false;var maxP=false;var minN=false;var maxN=false;
 var lengthP=${BOUNDARY_ITERATIONS}.0;var lengthN=${BOUNDARY_ITERATIONS}.0;
 for(var i=1;i<=${BOUNDARY_ITERATIONS};i++){
  if(!(minP||maxP)){
   let reached=edgeDepth(p+browse*i,side);
   minP=reached<minDepth;maxP=reached>maxDepth;
   if(minP||maxP){lengthP=f32(i-1);}
  }
  if(!(minN||maxN)){
   let reached=edgeDepth(p-browse*i,side);
   minN=reached<minDepth;maxN=reached>maxDepth;
   if(minN||maxN){lengthN=f32(i-1);}
  }
 }
 let brighter=found.edge>c;
 let incP=select(minP,maxP,brighter);let incN=select(minN,maxN,brighter);
 let decP=select(maxP,minP,brighter);let decN=select(maxN,minN,brighter);
 let iterations=${BOUNDARY_ITERATIONS + 1}.0;
 let maxInverse=1.0/iterations;
 let inverse=1.0/(1.0+lengthN+lengthP);
 var maxDistance=1.0;var maxSlope=0.0;
 if(decP&&decN){
  maxDistance=(min(lengthP,lengthN)+0.5)*maxInverse;
  maxSlope=select(select(0.0,maxInverse,lengthN<lengthP),-maxInverse,lengthP<lengthN);
 }else if(decP){
  maxDistance=(lengthP+0.5)*max(inverse,maxInverse);maxSlope=-max(inverse,maxInverse);
 }else if(decN){
  maxDistance=(lengthN+0.5)*max(inverse,maxInverse);maxSlope=max(inverse,maxInverse);
 }
 var minDistance=0.0;var minSlope=0.0;
 if(incP&&incN){
  minDistance=1.0-(min(lengthP,lengthN)+0.5)*maxInverse;
  minSlope=select(select(0.0,-maxInverse,lengthN<lengthP),maxInverse,lengthP<lengthN);
 }else if(incP){
  minDistance=1.0-(lengthP+0.5)*max(maxInverse,inverse);minSlope=max(inverse,maxInverse);
 }else if(incN){
  minDistance=1.0-(lengthN+0.5)*max(maxInverse,inverse);minSlope=-max(inverse,maxInverse);
 }
 minDistance=max(minDistance,1.0/1023.0);
 // The edge, dilated by half a texel at most: its distance held between the two bounds.
 let edgeDistance=max(minDistance,min(maxDistance,0.5));
 var slope=0.0;
 slope=select(slope,maxSlope,maxDistance<=0.5);
 slope=select(slope,minSlope,minDistance>0.5);
 let sideF=vec2f(side);
 var direction=sideF+vec2f(abs(sideF.y),abs(sideF.x))*slope;
 direction*=inverseSqrt(dot(direction,direction));
 let corner=saturate(sign(direction));
 let onEdge=vec2f(0.5)+sideF*(0.5-edgeDistance);
 return dot(corner-onEdge,direction)*direction;
}
fn isMoving(p:vec2i,zc:f32,closestZ:f32,nearest:TaaMotion,animated:bool)->f32{
 if(animated){return 1.0;}
 let radius=pixelRadiusAt(sceneDepthOf(closestZ))*2.0;
 var moving=saturate(nearest.shift/max(radius,1e-30)-1.0);
 let here=transformHomogeneousPoint(view.invViewProj,vec3f(screenOfTexel(p),zc));
 let seen=view.prevViewProj*here;
 let turned=seen+view.parallax*here.w;
 if(seen.w>0.0&&turned.w>0.0){
  let parallax=0.5*length((perspectiveDivide(turned).xy-perspectiveDivide(seen).xy)*view.render.xy);
  moving=max(moving,saturate(parallax*view.rates.x-0.5));
 }
 return moving;
}
fn scatterOccluder(screen:vec2f,v:vec2f,prevZ:f32){
 let size=vec2i(view.render.xy);
 let prevPixel=ndcToPixel(screen-v,view.render.xy);
 if(any(prevPixel<=vec2f(-0.5))||any(prevPixel>=view.render.xy+0.5)){return;}
 let code=encodeHoleFill(pixelVelocity(v));
 let r=prevPixel-0.5;let base=vec2i(floor(r));let f=r-vec2f(base);
 let ortho=view.radius.w!=0.0;
 var words=vec2u(occluderWord(prevZ,code),0u);
 if(ortho){words=orthoOccluderWords(prevZ,code);}
 let word=words.x;let low=words.y;
 let count=u32(size.x)*u32(size.y);
 for(var j=0u;j<4u;j++){
  let d=vec2i(i32(j&1u),i32(j>>1u));let at=base+d;
  let w=mix(1.0-f.x,f.x,f32(d.x))*mix(1.0-f.y,f.y,f32(d.y));
  if(round(w*${SCATTER_WEIGHT_STEPS}.0)<=0.0||any(at<vec2i(0))||any(at>=size)){continue;}
  let index=u32(at.y)*u32(size.x)+u32(at.x);
  let before=atomicMax(&occluders[index],word);
  if(ortho&&before<word){atomicMax(&occluders[count+index],low);}
 }
}`,
)

/** What the stages of the nearest velocity's text share: the workgroup's side, the fused blur it
 *  flattens the motion of, if any, and the store a lane past the image must not make. */
interface VelocityText {
  readonly tile: number
  readonly fused: BlurVariant | undefined
  readonly inImage: (store: string) => string
}

/** The pass's outputs and the vectors and responsiveness it reads. */
const velocityBindingsText =
  () => `@group(0) @binding(${VELOCITY_BINDINGS.closest}) var closestOut:texture_storage_2d<${CLOSEST_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.marks}) var marksOut:texture_storage_2d<${MARKS_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.occluders}) var<storage,read_write> occluders:array<atomic<u32>>;
@group(0) @binding(${VELOCITY_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${VELOCITY_BINDINGS.responsive}) var responsive:texture_2d<f32>;
@group(0) @binding(${VELOCITY_BINDINGS.jacobian}) var jacobianOut:texture_storage_2d<${FIELD_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.boundary}) var boundaryOut:texture_storage_2d<${FIELD_FORMAT},write>;`

/** The entry: the texel this lane takes, and the lanes past the image where the blur's tile runs on. */
const velocityEntryText = ({
  tile,
  fused,
}: VelocityText) => `@compute @workgroup_size(${tile},${tile})
fn nearestVelocity(@builtin(global_invocation_id) gid:vec3u${fused ? ',@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32' : ''}){
${
  fused
    ? ` let valid=all(vec2i(gid.xy)<vec2i(view.render.xy));
 let p=min(vec2i(gid.xy),vec2i(view.render.xy)-vec2i(1));`
    : ` let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}`
}`

/** The closest surface's velocity at the texel, the edge where it took a neighbour's, the pixel's flags. */
const velocitySurfaceText = ({ inImage }: VelocityText) => ` let surface=nearestSurface(p);
 let nearest=surface.motion;
 let zc=surface.depths[4];
 let tookNeighbour=any(surface.offset!=vec2i(0));
 // The edge is read only where the texel took a neighbour's velocity (the offset bit): there, how
 // far that velocity lies from the texel's own; elsewhere none, and its own is not computed.
 var edge=1.0;
 var ownVelocity=nearest.velocity.xy;
 if(tookNeighbour){
  let own=texelMotion(p,p,zc,surface.id);
  ownVelocity=own.velocity.xy;
  let delta=abs(pixelVelocity(nearest.velocity.xy-own.velocity.xy));
  edge=saturate(1.1-dot(delta,vec2f(1.1)));
 }
 let prevClosestZ=surface.closestZ-nearest.velocity.z;
 // The pixel's flags: its surface's, with the responsiveness of the layers over it.
 let flags=textureLoad(vectors,p,0).g|markedResponsive(textureLoad(responsive,p,0).r);
 let animated=(flags&${PIXEL_ANIMATED}u)!=0u;
 // How far the texel moves is measured only where the flicker measure reads it (\`view.quality.x\`), 0 else.
 var moving=0.0;
 if(view.quality.x!=0.0){moving=isMoving(p,zc,surface.closestZ,nearest,animated);}
 let signedZ=select(prevClosestZ,-prevClosestZ,animated);
 ${inImage('textureStore(closestOut,p,vec4u(bitcast<u32>(signedZ),0u,0u,0u));')}
 let offsetBit=select(0u,0x80u,tookNeighbour);
 let offsetCode=(u32(surface.offset.x+1)+u32(surface.offset.y+1)*4u)|select(0u,${RESTART_MARK}u,(flags&${PIXEL_RESTARTS}u)!=0u);
 var depthError=depthBilateralError(surface.depths);`

/** With the reprojection field: the jacobian of the 3×3's velocities and the boundary of the dilation. */
const velocityFieldText = ({ inImage }: VelocityText) => ` if(view.fraction.w!=0.0){
  var depths=surface.depths;
  var motion:array<vec2f,9>;
  for(var k=0;k<9;k++){
   let n=clampTexel(p+vec2i(k%3-1,k/3-1));
   let word=textureLoad(vectors,n,0).r;
   motion[k]=pixelVelocity(select(cameraOnlyMotion(screenOfTexel(n),depths[k]),decodeVector(word),hasOwnMotion(word)));
  }
  let field=reprojectionJacobian(depths,motion);
  depthError=field.error;
  ${inImage('textureStore(jacobianOut,p,vec4u(encodeReprojectionJacobian(field.jacobian.j0,field.jacobian.j1),0u,0u,0u));')}
  ${inImage('textureStore(boundaryOut,p,vec4u(encodeReprojectionBoundary(surface.offset,reprojectionBoundary(p,ownVelocity,nearest.velocity.xy,depths)),0u,0u,0u));')}
 }`

/** The marks, the occluder scattered where it stood, and where the blur is fused, its flattened motion. */
const velocityStoreText = ({
  fused,
  inImage,
}: VelocityText) => ` ${inImage('textureStore(marksOut,p,vec4u(u32(round(edge*127.0))|offsetBit,encodeDepthError(prevClosestZ,depthError),u32(round(moving*255.0)),offsetCode));')}
 ${inImage('scatterOccluder(screenOfTexel(p),nearest.velocity.xy,prevClosestZ);')}${
   fused
     ? `
 var blurMotion=nearest.velocity.xy;
 if(mb.knobs.w!=0.0){blurMotion=blurMotion-cameraMotion(p,surface.closestZ);}
 if(view.params.x!=0.0){blurMotion=vec2f(0.0);}
 var polar=toPolar(blurMotion*mb.scale.xy);
 polar.x=min(polar.x,mb.scale.z);
 ${flattenReduction(fused.directions > 1, `if(valid){storeFlat(p,${flatTexel('sceneDepthOf(surface.closestZ)')});}`)}`
     : ''
 }
}`

/**
 * The nearest velocity, once per render texel, before the history is reprojected: the nearest
 * surface of the texel (`nearestSurface`), then
 * - the parallax depth error: the depth steps to the four neighbours, each weighed by how far it
 *   continues the surface (`depthBilateralError`); with the reprojection field, the same steps
 *   along the diagonals where the horizontal and vertical ones found no neighbour to weigh
 *   (`reprojectionJacobian`);
 * - the reprojection edge, `1.1 − 1.1 · |Δv|₁` of the closest surface's velocity and, where the
 *   texel took a neighbour's, its own, in render pixels, one where it took none;
 * - how far the texel moves for the flicker measure (`isMoving`): its surface point's world motion
 *   past a pixel's diameter at its depth, and the camera's parallax at the texel past half the
 *   limit (`view.rates.x`); a pixel animation moves it in full — the flags of the texel's pixel
 *   are its vector's second word, the velocity stage's (`surfaceVelocityWgsl.ts`), with the
 *   responsiveness the layers over it carry (`responsive`); the marks keep whether they restart its
 *   history (`RESTART_MARK`);
 * - the closest occluder scattered where it stood in the last image (`scatterOccluder`): on the
 *   2×2 a bilinear read there weighs, each word keeping the greatest — the closest depth in its
 *   high bits, its hole-filling velocity in its low ones; under an orthographic projection the
 *   depth on 23 bits in both of two words, each carrying half of the velocity;
 * - with the reprojection field (`view.fraction.w`), the jacobian of the texel's reprojection
 *   from the velocities of its 3×3 (the vectors the stage wrote, the camera's motion at a neighbour
 *   that did not move by itself) and the boundary of the dilation (`reprojectionBoundary`),
 *   written beside the marks.
 * - with `fused`, the variant of a blur of the motion blur that flattens its motion here
 *   (`flattenWgsl.ts`): the workgroup is a tile of the blur's (`FLATTEN_TILE`), every lane of it
 *   running to the end, a lane past the image reading the edge texel and writing nothing; the
 *   texel's motion for the blur is the dilated velocity above — the camera's motion at the
 *   closest surface taken out where the blur follows what moves in the scene alone, none in a view
 *   cut —, scaled to the blur's pixels, flattened with the depth of the closest surface and
 *   reduced to the tile's range, the blur's own flattening pass left out.
 * Two reprojections per render texel where it takes a neighbour's velocity; with the field, nine
 * more and nine loads of the vectors.
 */
export const velocityShader = (wpo: WpoSet = NO_WPO, fused?: BlurVariant) => {
  const text: VelocityText = {
    tile: fused ? FLATTEN_TILE : TEXEL_TILE,
    fused,
    /** A store, kept for the texels of the image alone where the workgroup runs past it. */
    inImage: (store) => (fused ? `if(valid){${store}}` : store),
  }
  return wgslProgram(
    [
      velocityBindingsText,
      velocityEntryText,
      velocitySurfaceText,
      velocityFieldText,
      velocityStoreText,
    ]
      .map((stage) => stage(text))
      .join('\n'),
    [
      VELOCITY_HELPERS_WGSL,
      MARKED_RESPONSIVE_WGSL,
      ...(fused
        ? [
            flattenParams(FUSED_FLATTEN_SLOTS),
            flattenOutputs(FUSED_FLATTEN_SLOTS, fused.flat, fused.directions > 1),
            STILL_MOTION_WGSL,
            INVERSE_TWO_PI,
          ]
        : []),
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
}
