/**
 * What the composition (`shaders.ts` `composeSource`) reads and shows a pixel through, as WGSL
 * fragments of its one source: how the scene colour is read and its local exposure's gain, what
 * the pixel shown is made of and the dither added to it — the same four functions in the plain
 * and the finishing variant, so `composeAt` has none of its own for either — and the two ways
 * the display pixel is composed, sharpened or not.
 */

/**
 * The sharpen, in the composition itself, never a pass or a target of its own: the source pixel and
 * its cross, one source pixel away, read once each (`sourceValue`), before the bloom and the curve;
 * the pixel pulled away from its cross's sum by the strength over six (`strength / 6`, so a strength
 * of 1 is a unit-gain Laplacian), the view's sharpness (`view.viewport.w`), masked off where the
 * exposed luminance steps by one or more against a neighbour (`edge`), so a very bright edge is
 * never sharpened into a ring. The exposure that scales the step holds the local exposure's gain,
 * read from the pixel before it is sharpened (`gainOf`). A neighbour past the last column or row
 * reads the last one. At a strength of 0 — a uniform branch — and in a diagnostic view's raw
 * output the pixel is composed as it is, bit for bit.
 */
export const SHARPEN_WGSL = `
fn sourceNear(at:vec2f,step:vec2f)->vec3f{
 return sourceValue(clamp(at+step,vec2f(0.0),view.source.zw+0.999)).rgb;
}
fn composeColor(pixel:vec4f)->vec4f{
 let at=pixel.xy*view.source.xy;
 let value=sceneColor(at);
 let gain=gainOf(value,at);
 let strength=view.viewport.w;
 if(strength==0.0||view.viewport.z!=0.0){return composeAt(at,value,gain);}
 let c1=sourceNear(at,vec2f(-1.0,0.0));let c2=sourceNear(at,vec2f(1.0,0.0));
 let c3=sourceNear(at,vec2f(0.0,-1.0));let c4=sourceNear(at,vec2f(0.0,1.0));
 let a0=luminance(value.rgb);
 let steps=abs(vec4f(a0)-vec4f(luminance(c1),luminance(c2),luminance(c3),luminance(c4)));
 let edge=saturate(1.0-view.preExposure.y*gain*max(max(steps.x,steps.y),max(steps.z,steps.w)));
 let delta=(c1+c2+c3+c4)-value.rgb*4.0;
 return composeAt(at,vec4f(value.rgb+delta*(-edge*strength/6.0),value.a),gain);
}`

/** The composition with no sharpening: the display pixel composed once. */
export const UNSHARPENED_WGSL = `
fn composeColor(pixel:vec4f)->vec4f{
 let at=pixel.xy*view.source.xy;
 let value=sceneColor(at);
 return composeAt(at,value,gainOf(value,at));
}`

/**
 * The four functions of a plain composition: the scene colour is the source pixel, the local
 * exposure's gain 1, the pixel shown the source, no dither.
 */
export const PLAIN_HOOKS_WGSL = `
fn sceneColor(at:vec2f)->vec4f{return sourceValue(at);}
fn gainOf(value:vec4f,at:vec2f)->f32{return 1.0;}
fn shownAt(source:vec4f,at:vec2f,gain:f32)->vec4f{return source;}
fn ditherAt(at:vec2f)->f32{return 0.0;}`

/**
 * The four functions of a finishing composition (`../../post/finish/finishWgsl.ts`). With a colour
 * fringe the scene colour is the red and the alpha read where `fringeTaps` puts the red, the green
 * where it puts the green and the blue at the pixel, each bilinearly (`sourceBilinear`); with none,
 * the source pixel. The gain is the local exposure's, read from that colour (`localGainOf`); the
 * pixel shown is `finished` and the dither `ditherOf`, both at the pixel's place in the image
 * (`sourceUv`).
 */
export const FINISH_HOOKS_WGSL = `
fn sourceUv(at:vec2f)->vec2f{return at/(view.source.zw+vec2f(1.0));}
fn sceneColor(at:vec2f)->vec4f{
 if(!fringeActive()){return sourceValue(at);}
 let size=view.source.zw+vec2f(1.0);
 let taps=fringeTaps(at/size);
 let red=sourceBilinear(taps.xy*size);
 let green=sourceBilinear(taps.zw*size);
 return vec4f(red.r,green.g,sourceValue(at).b,red.a);
}
fn gainOf(value:vec4f,at:vec2f)->f32{return localGainOf(value,sourceUv(at));}
fn shownAt(source:vec4f,at:vec2f,gain:f32)->vec4f{return finished(source,sourceUv(at),gain);}
fn ditherAt(at:vec2f)->f32{return ditherOf(sourceUv(at));}`
