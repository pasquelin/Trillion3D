/**
 * THE RECONSTRUCTION'S PATHS, each the body of `reconstructMain` for one kind of image (the program
 * that holds it, `reconstructWgsl.ts`, declares what they read and write, and `reproject`):
 * - `MIN_MAX_PATH`: the history with two surfaces (mode 0), the colour, the secondary colour and
 *   the depth written;
 * - `plainPath`: the history with one surface (mode 0 without two surfaces), the colour and the
 *   depth written, the reprojected image held to the new neighbourhood or not;
 * - `MODE2_PATH`: the history of the quarter-to-full trace;
 * - `firstPath`: no history (the first image after a cut), the traced image enlarged bilinearly.
 */

/** The most the history's scene depth may be nearer or further than the new one's before the new
 *  sample replaces it, kilometres. */
const NEW_SAMPLE_KM = 2
/** The most the closest depths of the new and the history sample may differ before the history is
 *  replaced by the new sample, kilometres. */
const HISTORY_EDGE_KM = 1

/** The history with two surfaces: the new sample where this pixel was just traced or where the
 *  disocclusion test finds the history's depth off the new one's; else the reprojected sample, the
 *  new one where the closest depths of the two differ by more than a kilometre, an empty cloud at
 *  1000 km where anything it read is not finite; else the traced image read bilinearly. */
export const MIN_MAX_PATH = `
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 let r=reproject(position.xy);
 let fresh=Taps(loadBounded(tracedColour,view.traced,r.cell),loadBounded(tracedSecondary,view.traced,r.cell),fixupDepth(depthData(r.depth)));
 let newDepth=fresh.depth;
 let oldDepth=fixupDepth(depthData(sampleHistory(historyDepth,r.previousUv)));
 let disoccluded=any(newDepth.range<vec2f(view.distances.y))||any(oldDepth.range<vec2f(view.distances.y))||newDepth.scene<view.distances.y||oldDepth.scene<view.distances.y;
 let useNew=r.tracedNow||(disoccluded&&((abs(newDepth.range.x-newDepth.range.y)>${NEW_SAMPLE_KM}.0&&abs(newDepth.range.x-newDepth.scene)<abs(newDepth.range.y-newDepth.scene))||oldDepth.scene<newDepth.scene-${NEW_SAMPLE_KM}.0||oldDepth.scene>newDepth.scene+${NEW_SAMPLE_KM}.0));
 var taps=fresh;
 if(!useNew&&r.valid){
  taps=Taps(sampleHistory(historyColour,r.previousUv),sampleHistory(historySecondary,r.previousUv),oldDepth);
  if(abs(newDepth.range.x-oldDepth.range.x)>${HISTORY_EDGE_KM}.0){taps=fresh;}
  if(!(finite4(taps.colour)&&finite4(taps.secondary)&&finite2(vec2f(taps.depth.front,taps.depth.scene)))){
   let empty=vec4f(0.0,0.0,0.0,1.0);
   taps=Taps(empty,empty,DepthData(1000.0,1000.0,vec2f(1000.0)));
  }
 }else if(!useNew){
  taps=Taps(sampleTraced(tracedColour,screenUv),sampleTraced(tracedSecondary,screenUv),depthData(sampleTraced(tracedDepth,screenUv)));
 }
 return Reconstructed(taps.colour,taps.secondary,depthVector(taps.depth));
}
`

/** The depth of the plain paths' outputs: the front and the scene's, the rest zero. */
const PLAIN_OUT = `
fn plainOut(colour:vec4f,d:DepthData)->Reconstructed{return Reconstructed(colour,vec4f(d.front,d.scene,0.0,0.0));}
`

/** The distance from the eye, kilometres, of the point at device depth `deviceZ` on the ray of the
 *  traced texel's own pixel (not its centre), the shift of the tracing taken off. */
const PIXEL_DISTANCE = `
fn pixelDistanceKm(cell:vec2i,deviceZ:f32)->f32{
 let size=view.traced.coordRect.zw+vec2f(1.0);
 let ndc=pixelToNdc(vec2f(cell),size)-view.offset.zw;
 return length(unprojectPoint(view.inverseViewProj,vec3f(ndc,deviceZ)))*0.001;
}
`

/** Eight neighbours of a traced texel, counter-clockwise from the right. */
const NEIGHBOURS = `
fn neighbour(i:i32)->vec2i{
 var around=array<vec2i,8>(vec2i(1,0),vec2i(1,1),vec2i(0,1),vec2i(-1,1),vec2i(-1,0),vec2i(-1,-1),vec2i(0,-1),vec2i(1,-1));
 return around[i];
}
/** A traced texel read at a coordinate held as an unsigned number: one under zero is a very large
 *  number, which the clamp brings to the last texel. */
fn loadAround(t:texture_2d<f32>,c:vec2i)->vec4f{
 return textureLoad(t,clamp(bitcast<vec2u>(c),vec2u(view.traced.coordRect.xy),vec2u(view.traced.coordRect.zw)),0);
}
`

/** The reprojected image held to the box of the new sample and its eight neighbours: the colour
 *  and the transmittance, the front and the scene's depths. */
const BOX_CONSTRAINT = `
  var colourMin=vec4f(999999999.0);
  var colourMax=vec4f(0.0);
  var depthMin=vec2f(999999999.0);
  var depthMax=vec2f(0.0);
  for(var i=0;i<8;i++){
   let colour=loadAround(tracedColour,r.cell+neighbour(i));
   let d=depthData(loadAround(tracedDepth,r.cell+neighbour(i)));
   colourMin=min(colourMin,colour);
   colourMax=max(colourMax,colour);
   depthMin=min(depthMin,vec2f(d.front,d.scene));
   depthMax=max(depthMax,vec2f(d.front,d.scene));
  }
  colourMin=min(colourMin,freshColour);
  colourMax=max(colourMax,freshColour);
  depthMin=min(depthMin,vec2f(newDepth.front,newDepth.scene));
  depthMax=max(depthMax,vec2f(newDepth.front,newDepth.scene));
  colour=clamp(colour,colourMin,colourMax);
  let held=clamp(vec2f(depth.front,depth.scene),depthMin,depthMax);
  depth.front=held.x;
  depth.scene=held.y;`

/** The history with one surface: the new sample where this pixel was just traced; else the
 *  reprojected one, replaced by the closest of the neighbouring samples in scene depth where the
 *  history's depth is off the pixel's own by a tenth of it (`halfDepth` giving the pixel's), held
 *  to the box if asked; else the traced image read bilinearly. */
export const plainPath = (boxConstraint: boolean) => `${PLAIN_OUT}${PIXEL_DISTANCE}${NEIGHBOURS}
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 let r=reproject(position.xy);
 let freshColour=loadBounded(tracedColour,view.traced,r.cell);
 let newDepth=fixupDepth(depthData(r.depth));
 if(r.tracedNow){return plainOut(freshColour,newDepth);}
 if(!r.valid){return plainOut(sampleTraced(tracedColour,screenUv),depthData(sampleTraced(tracedDepth,screenUv)));}
 var colour=sampleHistory(historyColour,r.previousUv);
 var depth=depthData(sampleHistory(historyDepth,r.previousUv));
 let deviceZ=textureLoad(halfDepth,vec2i(position.xy),0).x;
 let distanceKm=pixelDistanceKm(r.cell,deviceZ);
 if(deviceZ>0.0&&abs(distanceKm-depth.scene)>distanceKm*0.1){
  var closest=99999999.0;
  for(var i=0;i<8;i++){
   let d=depthData(loadAround(tracedDepth,r.cell+neighbour(i)));
   let gap=abs(distanceKm-d.scene);
   if(gap<closest){
    closest=gap;
    colour=loadAround(tracedColour,r.cell+neighbour(i));
    depth=d;
   }
  }
 }else{${boxConstraint ? BOX_CONSTRAINT : ''}
 }
 if(!(finite4(colour)&&finite2(vec2f(depth.front,depth.scene)))){
  colour=vec4f(0.0,0.0,0.0,1.0);
  depth.front=1000.0;
  depth.scene=1000.0;
 }
 return plainOut(colour,depth);
}
`

/** The history of the quarter-to-full trace: the new sample for the pixel traced now, else the
 *  reprojected one, else the traced image read bilinearly, shifted so that the pixels traced now
 *  line up with the centres of their traced texels. */
export const MODE2_PATH = (downsample: number) => `${PLAIN_OUT}
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 let r=reproject(position.xy);
 if(r.tracedNow){return plainOut(loadBounded(tracedColour,view.traced,r.cell),depthData(r.depth));}
 if(r.valid){return plainOut(sampleHistory(historyColour,r.previousUv),depthData(sampleHistory(historyDepth,r.previousUv)));}
 let shift=-(view.offset.xy-(${downsample}.0-1.0)*0.5);
 let uv=screenUv+shift*view.destination.zw;
 return plainOut(sampleTraced(tracedColour,uv),depthData(sampleTraced(tracedDepth,uv)));
}
`

/** No history: the traced image enlarged bilinearly, its two surfaces or one. */
export const firstPath = (minMax: boolean) =>
  minMax
    ? `
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 return Reconstructed(sampleTraced(tracedColour,screenUv),sampleTraced(tracedSecondary,screenUv),sampleTraced(tracedDepth,screenUv));
}
`
    : `${PLAIN_OUT}
@fragment fn reconstructMain(@builtin(position) position:vec4f)->Reconstructed{
 let screenUv=position.xy*view.destination.zw;
 return plainOut(sampleTraced(tracedColour,screenUv),depthData(sampleTraced(tracedDepth,screenUv)));
}
`
