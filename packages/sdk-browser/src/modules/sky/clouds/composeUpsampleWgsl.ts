/**
 * THE COMPOSITION'S FIRST FOUR WAYS to enlarge the clouds over the scene, each the body of
 * `composeMain` (`composeWgsl.ts` declares what they read: the cloud images through their bounds,
 * `volumeUv` the pixel's place in them, `jitters` the four shifted places, `fogOnCloud` and
 * `fogFromUv` the fog laid late, `pixelKm` the pixel's distance from the eye in the ways that read the
 * scene's depth):
 * - 0, bilinear: the secondary image (the colour image where only one surface is traced) loaded at
 *   the pixel's place, the fog laid at its front depth read bilinearly; no scene depth is read;
 * - 1, bilinear with a jitter: the colour image read bilinearly at four places shifted by a random
 *   unit step, each with its fog, their mean; no scene depth is read;
 * - 2, the nearest with a depth test: the colour image read bilinearly at the pixel's place, kept
 *   where the pixel is beyond the cloud's front depth read bilinearly, else nothing;
 * - 3, as 1 with the depth test of 2: the mean of those of the four samples whose front depth lies
 *   in front of the pixel, nothing where none does.
 */

/** Way 0. */
export const BILINEAR_UPSAMPLING = `
 let uv=volumeUv(position.xy);
 let front=sampleBounded(cloudDepth,view.bounds,uv).x;
 return fogAtPixel(position.xy,front,loadSecondary(vec2i(uv*view.textureSize.xy)));`

/** Way 1. */
export const JITTER_UPSAMPLING = `
 var at=jitters(position.xy);
 var sum=vec4f(0.0);
 for(var k=0;k<4;k++){sum+=fogFromUv(at[k],sampleBounded(cloudColour,view.bounds,at[k]));}
 return 0.25*sum;`

/** Way 2. */
export const NEAREST_UPSAMPLING = `
 let uv=volumeUv(position.xy);
 let cloud=sampleBounded(cloudColour,view.bounds,uv);
 let front=sampleBounded(cloudDepth,view.bounds,uv).x;
 if(pixelKm>front){return fogOnCloud(uv,front,cloud);}
 discard;
 return vec4f(0.0,0.0,0.0,1.0);`

/** Way 3. */
export const JITTER_DEPTH_UPSAMPLING = `
 var at=jitters(position.xy);
 var sum=vec4f(0.0);
 var valid=0.0;
 for(var k=0;k<4;k++){
  let front=sampleBounded(cloudDepth,view.bounds,at[k]).x;
  if(pixelKm>front){
   sum+=fogOnCloud(at[k],front,sampleBounded(cloudColour,view.bounds,at[k]));
   valid+=1.0;
  }
 }
 if(valid>0.0){return sum/valid;}
 discard;
 return vec4f(0.0,0.0,0.0,1.0);`
