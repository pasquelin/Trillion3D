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

/** The four texels around the pixel, and the soft sample's position among them. */
export const BILATERAL_TEXELS = `
 let size=i32(view.scale.y);
 let low=pixel/size;
 let side=vec2i(select(1,-1,low.x*size==pixel.x),select(1,-1,low.y*size==pixel.y));
 var coords=array<vec2i,4>(max(low,vec2i(0)),max(low+vec2i(side.x,0),vec2i(0)),max(low+side,vec2i(0)),max(low+vec2i(0,side.y),vec2i(0)));
 var depths=array<vec4f,4>(loadBounded(cloudDepth,view.bounds,coords[0]),loadBounded(cloudDepth,view.bounds,coords[1]),loadBounded(cloudDepth,view.bounds,coords[2]),loadBounded(cloudDepth,view.bounds,coords[3]));
 let softUv=(vec2f(coords[0])+0.25+(vec2f(side)*0.5+0.5)*0.5)*view.textureSize.zw;`

export const MIN_MAX_BILATERAL = `${BILATERAL_TEXELS}
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
 if(all(fronts>vec4f(pixelKm+${FRONT_MARGIN_KM}))){discard;}
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
 let reachKm=max(max(depths[0].y,depths[1].y),max(depths[2].y,depths[3].y));
 let distanceKm=min(pixelKm,reachKm);
 let sceneDepths=vec4f(depths[0].y,depths[1].y,depths[2].y,depths[3].y);
 let gap=abs(vec4f(distanceKm)-sceneDepths);
 if(max(max(gap.x,gap.y),max(gap.z,gap.w))>distanceKm*${BLEND_SHARE}){
  var weights=vec4f(1.0)/(gap*${WEIGHT_PER_KM}.0+vec4f(1.0));
  weights=weights/dot(weights,vec4f(1.0));
  let blended=weights.x*loadBounded(cloudColour,view.bounds,coords[0])+weights.y*loadBounded(cloudColour,view.bounds,coords[1])+weights.z*loadBounded(cloudColour,view.bounds,coords[2])+weights.w*loadBounded(cloudColour,view.bounds,coords[3]);
  let frontKm=weights.x*depths[0].x+weights.y*depths[1].x+weights.z*depths[2].x+weights.w*depths[3].x;
  return fogOnCloud(position.xy*frame.size.zw,frontKm,blended);
 }
 return fogFromUv(softUv,sampleBounded(cloudColour,view.bounds,softUv));`
