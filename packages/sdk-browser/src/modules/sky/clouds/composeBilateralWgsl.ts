/**
 * THE BILATERAL ENLARGING, the composition's fourth way (`composeWgsl.ts` declares what these read,
 * and the pixel's distance `pixelKm`, its pixel `pixel` and the cloud's images). Per view pixel it
 * reads the 2×2 of texels nearest to it: its own and the three on the side of it the pixel lies
 * on (`low`, `side`, `coords`), whatever the image's size.
 *
 * With two surfaces (`MIN_MAX_BILATERAL`) each texel holds a closest and a furthest scene depth:
 * - the one nearest the pixel's distance is chosen (the first without a test), the closest depth
 *   taking the secondary image, the furthest the colour image;
 * - a pixel every cloud front of which lies behind its distance takes no cloud;
 * - where every cloud front is no further than its texel's closest depth, and the range of the
 *   eight depths of the four texels is under a kilometre or every depth is as far as the distance
 *   that disables the disocclusion, the colour image is read bilinearly, for a soft look;
 *   elsewhere the chosen texel is read as it is.
 *
 * Over a pixel the single-layer water was shaded on (`isWaterPixel`), the clouds that count are those in front of the water's
 * surface: with two surfaces each texel's furthest depth is held to the pixel's distance, a pixel no cloud front lies before takes no
 * cloud, and the cloud is read bilinearly; with one surface the blend by depth is kept for a pixel no cloud lies before, and the
 * texels whose scene depth reaches the water are taken alone where far water meets depths of an unrendered distance.
 *
 * With one surface (`PLAIN_BILATERAL`): the pixel's distance is held to the furthest scene depth of
 * the four; where the four depths differ from it by more than a tenth of it the four texels are
 * blended by the inverse of their depth gap (a thousand per kilometre, plus one), the fog laid once
 * on the blend at its mean front depth; elsewhere the colour image is read bilinearly.
 */

/** A cloud front is behind the pixel, past this margin, km. */
const FRONT_MARGIN_KM = 0.001
/** The cloud is read bilinearly where the range of the four texels' depths is under this, km. */
const BILINEAR_RANGE_KM = 1
/** The weight of a depth gap, per kilometre. */
const WEIGHT_PER_KM = 1000
/** The share of its distance a pixel's depth may differ from the four texels' before they are
 *  blended by their depth. */
const BLEND_SHARE = 0.1
/** Over water: a scene depth beyond this is a pixel the depth pass did not render, kilometres; the far water this far from the eye takes
 *  the texels whose scene depth reaches it, within this tolerance. */
const UNRENDERED_KM = 500
const FAR_WATER_KM = 1
const WATER_ACCEPTANCE_KM = 0.001

/** The four texels around the pixel, and the soft sample's position among them. */
const BILATERAL_TEXELS = `
 let size=i32(view.scale.y);
 let low=pixel/size;
 let side=vec2i(select(1,-1,low.x*size==pixel.x),select(1,-1,low.y*size==pixel.y));
 var coords=array<vec2i,4>(max(low,vec2i(0)),max(low+vec2i(side.x,0),vec2i(0)),max(low+side,vec2i(0)),max(low+vec2i(0,side.y),vec2i(0)));
 var depths=array<vec4f,4>(loadBounded(cloudDepth,view.bounds,coords[0]),loadBounded(cloudDepth,view.bounds,coords[1]),loadBounded(cloudDepth,view.bounds,coords[2]),loadBounded(cloudDepth,view.bounds,coords[3]));
 let softUv=(vec2f(coords[0])+0.25+(vec2f(side)*0.5+0.5)*0.5)*view.textureSize.zw;`

export const MIN_MAX_BILATERAL = `${BILATERAL_TEXELS}
 // Over the water the furthest depth of a texel is no further than the water.
 let water=isWaterPixel(pixel);
 if(water){for(var k=0;k<4;k++){depths[k].w=min(depths[k].w,pixelKm);}}
 var best=coords[0];var bestDepth=depths[0].w;var bestGap=abs(pixelKm-depths[0].w);var bestFront=false;
 var farthest=depths[0].w;var nearest=depths[0].w;
 for(var k=0;k<4;k++){
  for(var c=0;c<2;c++){
   let d=depths[k][3-c];
   let gap=abs(pixelKm-d);
   if(gap<bestGap){best=coords[k];bestDepth=d;bestGap=gap;bestFront=c==1;}
   farthest=max(farthest,d);
   nearest=min(nearest,d);
  }
 }
 let fronts=vec4f(depths[0].x,depths[1].x,depths[2].x,depths[3].x);
 if(water&&!any(fronts<vec4f(pixelKm))){discard;}
 if(all(fronts>vec4f(pixelKm+${FRONT_MARGIN_KM}))){discard;}
 if(water){return fogFromUv(softUv,sampleBounded(cloudColour,view.bounds,softUv));}
 let closests=vec4f(depths[0].z,depths[1].z,depths[2].z,depths[3].z);
 let frontOfClosest=all(fronts<=closests);
 let leastDepth=min(min(depths[0].yzw,depths[1].yzw),min(depths[2].yzw,depths[3].yzw));
 let farEnough=all(leastDepth>=vec3f(view.distances.y));
 if(frontOfClosest&&(farthest-nearest<${BILINEAR_RANGE_KM}.0||farEnough)){
  return fogFromUv(softUv,sampleBounded(cloudColour,view.bounds,softUv));
 }
 let texel=select(loadBounded(cloudColour,view.bounds,best),loadBounded(cloudSecondary,view.bounds,best),bestFront);
 return fogOnCloud(vec2f(best)*view.textureSize.zw,bestDepth,texel);`

export const PLAIN_BILATERAL = `${BILATERAL_TEXELS}
 let water=isWaterPixel(pixel);
 let anyFront=any(vec4f(depths[0].x,depths[1].x,depths[2].x,depths[3].x)<vec4f(pixelKm));
 let reachKm=max(max(depths[0].y,depths[1].y),max(depths[2].y,depths[3].y));
 let distanceKm=min(pixelKm,reachKm);
 let sceneDepths=vec4f(depths[0].y,depths[1].y,depths[2].y,depths[3].y);
 let gap=abs(vec4f(distanceKm)-sceneDepths);
 if(max(max(gap.x,gap.y),max(gap.z,gap.w))>distanceKm*${BLEND_SHARE}){
  var sum=vec4f(0.0);var frontSum=0.0;var count=0.0;
  if(water&&any(sceneDepths>vec4f(${UNRENDERED_KM}.0))&&!all(sceneDepths>vec4f(${UNRENDERED_KM}.0))&&distanceKm>${FAR_WATER_KM}.0){
   for(var k=0;k<4;k++){
    if(depths[k].y>distanceKm-${WATER_ACCEPTANCE_KM}){
     sum+=loadBounded(cloudColour,view.bounds,coords[k]);
     frontSum+=depths[k].x;
     count+=1.0;
    }
   }
  }
  if(!water||(count==0.0&&anyFront)){
   var weights=vec4f(1.0)/(gap*${WEIGHT_PER_KM}.0+vec4f(1.0));
   weights=weights/dot(weights,vec4f(1.0));
   sum=weights.x*loadBounded(cloudColour,view.bounds,coords[0])+weights.y*loadBounded(cloudColour,view.bounds,coords[1])+weights.z*loadBounded(cloudColour,view.bounds,coords[2])+weights.w*loadBounded(cloudColour,view.bounds,coords[3]);
   frontSum=weights.x*depths[0].x+weights.y*depths[1].x+weights.z*depths[2].x+weights.w*depths[3].x;
   count=1.0;
  }
  if(count==0.0){discard;}
  return fogOnCloud(position.xy*frame.size.zw,frontSum/count,sum/count);
 }
 return fogFromUv(softUv,sampleBounded(cloudColour,view.bounds,softUv));`

/** The depth of a cloud front must be this much in front of the pixel's distance to count, kilometres. */
const FRONT_TINY_KM = 0.001
/** The places are looked at again, further out, when none of the four held a cloud in front of the pixel. */
const FURTHER_PLACES = 3

/**
 * The bilateral way for the scene copy behind the water (`composeProgram`'s `under`): the pixel's distance is the copy's, and the
 * cloud is the mean of the four jittered places (`jitters`) whose front lies in front of that distance and in front of the traced
 * depth. When none does, the places are shifted out to three times their distance, their two axes swapped, and looked at again;
 * when none does then, nothing is laid. The fog is laid once on the mean, at the mean front depth.
 */
export const UNDER_BILATERAL = `
 let places=jitters(position.xy);
 let origin=volumeUv(position.xy);
 var sum=vec4f(0.0);var frontSum=0.0;var valid=0.0;
 for(var round=0;round<2;round++){
  for(var k=0;k<4;k++){
   var uv=places[k];
   if(round==1){uv=origin+(places[k]-origin).yx*${FURTHER_PLACES}.0;}
   let at=vec2i(uv*view.textureSize.xy);
   let depth=loadBounded(cloudDepth,view.bounds,at);
   if(pixelKm>depth.x-${FRONT_TINY_KM}&&depth.x<depth.y){
    sum+=loadBounded(cloudColour,view.bounds,at);
    frontSum+=depth.x;
    valid+=1.0;
   }
  }
  if(valid>0.0){break;}
 }
 if(valid==0.0){discard;}
 return fogAtPixel(position.xy,frontSum/valid,sum/valid);`
