import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { VG_RANDOM_SEQUENCE_WGSL } from './randomSequenceWgsl.ts'
import { VG_TRAVERSAL_WGSL } from './gridTraversalWgsl.ts'

/**
 * THE WAYS OF FOLLOWING A RAY THROUGH THE ORTHO GRID, each giving a TrackingResult: the radiance gathered, the throughput left in each
 * channel, the density of the distance it chose (pdf), the distance it travelled and whether it ended in a scattering.
 *
 * By samples: a march in steps of a given length reading the extinction at each (`trackSampleBasedMarch`), or the majorant of the cell
 * (`trackSampleBasedMajorantMarch`) or the greatest majorant of the grid (`trackSampleBasedMaxMajorantMarch`).
 * By tracking, a random walk whose steps follow the majorant sigmaBar, the extinction read where it lands: delta tracking
 * (`trackDelta`: the walk stops, with the cell's emission, where a draw falls under the extinction over the majorant), spectral weighted
 * delta tracking (`trackSpectralWeightedDelta`: at each landing the walk picks between absorption, scattering and a null collision by
 * their weights seen through the throughput), ratio tracking (`trackRatio`: the throughput times one minus the extinction over the
 * majorant, a channel at a time for the spectral variant `trackSpectralRatio`).
 * And along the majorant grid, cell by cell (`trackDdaMajorantMarch`): each cell crossed is followed by samples or by delta tracking with
 * the cell's majorant as sigmaBar, the results concatenated, the walk stopping at the first scattering.
 *
 * The host declares what `VG_EVAL_WGSL` lists and `gridMaterial` (read-only storage, four words a bottom-level cell: the emission, then the
 * scattering albedo times the extinction) and `gridMajorant` (read-only storage, two words a top-level cell).
 */
export const VG_TRACKING_WGSL = wgslBlock(
  'VG_TRACKING_WGSL',
  [VG_TRAVERSAL_WGSL, VG_RANDOM_SEQUENCE_WGSL, luminance],
  `struct TrackingResult{radiance:vec3f,throughput:vec3f,pdf:f32,distance:f32,scattering:bool,}
fn trackingCreate(travelled:f32)->TrackingResult{
 return TrackingResult(vec3f(0.0),vec3f(1.0),0.0,travelled,false);
}
/** The result of 'next' after 'first': the radiance 'next' gathers, seen through what 'first' left, added to the radiance already gathered
 *  (the reference drops the radiance of 'first'); the throughputs multiplied, the distances added. */
fn trackingConcatenate(first:TrackingResult,next:TrackingResult)->TrackingResult{
 return TrackingResult(first.radiance+next.radiance*first.throughput,first.throughput*next.throughput,first.pdf*next.pdf,first.distance+next.distance,next.scattering);
}
fn trackEmissionAt(cell:u32)->vec3f{return vgColorOf(gridMaterial[cell].xy);}
fn trackAlbedoAt(cell:u32)->vec3f{return vgColorOf(gridMaterial[cell].zw);}
/** The extinction at a world point and the cell it was read from (-1 where the grid holds none). */
fn trackExtinctionAt(world:vec3f,cell:ptr<function,i32>)->vec3f{
 *cell=vgOrthoCellAt(world);
 if(*cell<0){return vec3f(0.0);}
 return vgColorOf(gridExtinction[u32(*cell)]);
}

/** The majorant of the top-level cell a world point is in; zero outside the grid. */
fn trackMajorantAt(world:vec3f)->f32{
 let uv=(world-gridParams.orthoMin)/(gridParams.orthoMax-gridParams.orthoMin);
 if(any(uv<vec3f(0.0))||any(uv>vec3f(1.0))){return 0.0;}
 let cell=min(vec3u(uv*vec3f(gridParams.orthoResolution)),vec3u(gridParams.orthoResolution-vec3i(1)));
 return vgMajorantOf(gridMajorant[vgLinearIndex(cell,gridParams.orthoResolution)]);
}
/** The step across one bottom-level cell along a direction, the smallest of the three axes' (the cells of the top level times those of the
 *  bottom level and the indirection grid, 'gridParams.cellVoxels' a side); 0.0001 at least. */
fn trackStepSize(direction:vec3f)->f32{
 let voxel=(gridParams.orthoMax-gridParams.orthoMin)/(vec3f(gridParams.orthoResolution)*f32(gridParams.cellVoxels.x));
 let along=voxel/abs(direction);
 return max(min(along.x,min(along.y,along.z)),1.0e-4);
}

fn trackSampleBasedMarch(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,stepSize:f32)->TrackingResult{
 var result=trackingCreate(tMin);
 var hitT=tMin;
 while(hitT<tMax&&any(result.throughput>vec3f(1.0e-4))){
  var cell=0;
  let extinction=trackExtinctionAt(origin+direction*hitT,&cell);
  if(any(extinction>vec3f(0.0))){result.radiance+=trackEmissionAt(u32(cell))*result.throughput;}
  result.throughput*=exp(-extinction*stepSize);
  hitT+=stepSize;
 }
 result.distance=hitT;
 return result;
}
fn trackSampleBasedMajorantMarch(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,stepSize:f32)->TrackingResult{
 var result=trackingCreate(tMin);
 var hitT=tMin;
 while(hitT<tMax&&any(result.throughput>vec3f(1.0e-3))){
  result.throughput*=exp(-trackMajorantAt(origin+direction*hitT)*stepSize);
  hitT+=stepSize;
 }
 result.distance=hitT;
 result.pdf=result.throughput.x;
 return result;
}
fn trackSampleBasedMaxMajorantMarch(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,stepSize:f32)->TrackingResult{
 var result=trackingCreate(tMin);
 var hitT=tMin;
 let majorant=vgMajorantOf(gridMajorant[0]);
 while(hitT<tMax&&any(result.throughput>vec3f(1.0e-3))){
  result.throughput*=exp(-majorant*stepSize);
  hitT+=stepSize;
 }
 result.distance=hitT;
 result.pdf=result.throughput.x;
 return result;
}

fn trackDelta(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,sigmaBar:f32,sequence:ptr<function,RandomSequence>)->TrackingResult{
 var result=trackingCreate(tMin);
 while(result.distance<tMax){
  result.distance+=(-log(1.0-randomDraw(sequence)))/sigmaBar;
  if(result.distance<tMax){
   var cell=0;
   let sigmaT=luminance(trackExtinctionAt(origin+direction*result.distance,&cell));
   if(randomDraw(sequence)<min(sigmaT/sigmaBar,1.0)){
    result.throughput=vec3f(0.0);
    result.radiance=trackEmissionAt(u32(cell))/sigmaT;
    break;
   }
  }
 }
 result.distance=min(result.distance,tMax);
 result.pdf=sigmaBar*exp(-sigmaBar*(result.distance-tMin));
 return result;
}

fn trackSpectralWeightedDelta(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,sigmaBar:f32,sequence:ptr<function,RandomSequence>)->TrackingResult{
 var result=trackingCreate(tMin);
 while(result.distance<tMax&&all(result.throughput>vec3f(1.0e-4))){
  result.distance+=(-log(1.0-randomDraw(sequence)))/sigmaBar;
  if(result.distance<tMax){
   var cell=0;
   let extinction=trackExtinctionAt(origin+direction*result.distance,&cell);
   // The albedo is kept as the scattering coefficient; a channel with no extinction scatters nothing.
   var albedo=vec3f(0.0);
   if(cell>=0){albedo=select(vec3f(0.0),trackAlbedoAt(u32(cell))/extinction,extinction>vec3f(0.0));}
   let absorbing=extinction*(vec3f(1.0)-albedo)/sigmaBar;
   let scattering=extinction*albedo/sigmaBar;
   let nothing=vec3f(1.0)-extinction/sigmaBar;
   // The collision is picked in proportion to the weights seen through the throughput.
   let absorption=dot(absorbing,result.throughput);
   let scatter=dot(scattering,result.throughput);
   let nullCollision=dot(nothing,result.throughput);
   let cdf=vec3f(absorption,absorption+scatter,absorption+scatter+nullCollision);
   let pick=randomDraw(sequence)*cdf.z;
   let total=1.0/cdf.z;
   if(pick<cdf.x){
    result.throughput*=absorbing/(absorption*total);
    result.radiance=trackEmissionAt(u32(cell))*result.throughput;
    result.throughput=vec3f(0.0);
    break;
   }else if(pick<cdf.y){
    result.throughput*=scattering/(scatter*total);
    result.scattering=true;
    break;
   }else{
    result.throughput*=nothing/(nullCollision*total);
   }
  }
 }
 result.distance=min(result.distance,tMax);
 result.pdf=sigmaBar*exp(-sigmaBar*(result.distance-tMin));
 return result;
}

fn trackRatio(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,sigmaBar:f32,sequence:ptr<function,RandomSequence>)->TrackingResult{
 var result=trackingCreate(tMin);
 while(result.distance<tMax&&all(result.throughput>vec3f(1.0e-5))){
  result.distance+=(-log(1.0-randomDraw(sequence)))/sigmaBar;
  if(result.distance<tMax){
   var cell=0;
   let sigmaT=luminance(trackExtinctionAt(origin+direction*result.distance,&cell));
   let acceptance=min(sigmaT/sigmaBar,1.0);
   // The draw that decides whether the collision would emit is spent, as the sequence runs on it, but the walk gathers no radiance.
   _=randomDraw(sequence);
   result.throughput*=1.0-acceptance;
  }
 }
 result.distance=min(result.distance,tMax);
 result.pdf=sigmaBar*exp(-sigmaBar*(result.distance-tMin));
 return result;
}

fn trackSpectralRatio(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,sigmaBar:f32,sequence:ptr<function,RandomSequence>)->TrackingResult{
 var result=trackingCreate(tMin);
 while(result.distance<tMax&&all(result.throughput>vec3f(1.0e-5))){
  result.distance+=(-log(1.0-randomDraw(sequence)))/sigmaBar;
  if(result.distance<tMax){
   var cell=0;
   let extinction=trackExtinctionAt(origin+direction*result.distance,&cell);
   // A channel is picked in proportion to its extinction.
   let cdf=vec3f(extinction.x,extinction.x+extinction.y,extinction.x+extinction.y+extinction.z);
   let pick=randomDraw(sequence)*cdf.z;
   var sigmaT=extinction.z;
   if(pick<cdf.x){sigmaT=extinction.x;}else if(pick<cdf.y){sigmaT=extinction.y;}
   if(sigmaT>0.0){
    let acceptance=min(extinction/sigmaT*sigmaT/sigmaBar,vec3f(1.0));
    _=randomDraw(sequence);
    result.throughput*=vec3f(1.0)-acceptance;
   }
  }
 }
 result.distance=min(result.distance,tMax);
 result.pdf=sigmaBar*exp(-sigmaBar*(result.distance-tMin));
 return result;
}

/** The ray from tMin to tMax walked through the majorant grid cell by cell; each cell's span is followed by delta tracking with the cell's majorant,
 *  or, where 'byDelta' is false, by a march in samples. */
fn trackDdaMajorantMarch(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,byDelta:bool,sequence:ptr<function,RandomSequence>)->TrackingResult{
 var tracking=trackingCreate(tMin);
 let begin=origin+direction*tMin;
 let worldLength=length(direction*(tMax-tMin));
 let extent=gridParams.orthoMax-gridParams.orthoMin;
 let resolution=vec3f(gridParams.orthoResolution);
 let voxelBegin=(begin-gridParams.orthoMin)/extent*resolution;
 let voxelEnd=(origin+direction*tMax-gridParams.orthoMin)/extent*resolution;
 var voxelDirection=voxelEnd-voxelBegin;
 let voxelLength=length(voxelDirection);
 voxelDirection/=voxelLength;
 let toWorld=worldLength/voxelLength;
 let inverse=vec3f(1.0)/voxelDirection;
 var marched=0.0;
 var position=voxelBegin;
 var hit=vgDdaStart(position,voxelDirection,inverse);
 let last=vec3f(gridParams.orthoResolution-vec3i(1));
 while(marched<voxelLength&&any(tracking.throughput>vec3f(1.0e-4))&&!tracking.scattering){
  var delta=vgDdaStep(&hit,inverse,marched);
  if(marched+delta>voxelLength){delta=voxelLength-marched;}
  let end=position+voxelDirection*delta;
  let at=clamp((position+end)*0.5,vec3f(0.0),last);
  let majorant=vgMajorantOf(gridMajorant[vgLinearIndex(vec3u(at),gridParams.orthoResolution)]);
  let spanStart=begin+direction*marched*toWorld;
  let span=delta*toWorld;
  if(byDelta){
   tracking=trackingConcatenate(tracking,trackDelta(spanStart,direction,0.0,span,majorant,sequence));
  }else{
   tracking=trackingConcatenate(tracking,trackSampleBasedMarch(spanStart,direction,0.0,span,trackStepSize(direction)));
  }
  marched+=delta;
  position=end;
 }
 return tracking;
}`,
)
