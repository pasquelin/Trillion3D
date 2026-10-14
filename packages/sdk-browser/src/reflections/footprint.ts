import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_CONE_WGSL, REFLECTION_LOBE_WGSL } from './field.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'

/**
 * The footprint a hit reads, its resources in bind group `group`: the previous image, reprojected
 * with the view-projection it was drawn with, read from its filtered pyramid (`radiance.ts`) over
 * the reflected lobe's footprint there — an ellipse whose axes are 2 · hit distance · tan of the
 * GGX lobe's half-maximum angle (`reflectionConeTangent`) at the lobe's two widths, its long axis
 * along the lobe's (`ReflectionLobe`) —; the pyramid level is the short axis's (or the long axis's
 * share of the taps), read smooth between and within levels, and up to `REFLECTION_TAPS` taps cover
 * the long axis. The colour is the weighted reads over their coverage (the image's alpha: 0 on the
 * background); the share of the depth-weighted reads the image covers multiplies the confidence.
 * Its reads sum as `ReflectionTaps`: the depth-weighted colour and coverage, and the depth weights.
 * `toView` maps a point of the radiance image to this image's pixels (`xy` + uv · `zw`), the hit's
 * at the centre of the pixel the ray stopped in, where the depth is read; `ReflectionSurface` is
 * that pixel, its plane and half the hit's slab (`screenBack`).
 * `reflectionConeAt`: the cone of `lobe` at `distance` from its surface, a pixel `pixel` wide there —
 * its axes' diameters in pixels, at least one, and the pyramid level of the width a read spans, the
 * short axis's or the long axis's share of `REFLECTION_TAPS` taps.
 * `reflectionDepthWeight`: 1 where the depth at `X` lies within the surface's thickness of its plane
 * carried to `X`, widened by the depth the plane spans from its pixel to `X`, falling smoothly to 0
 * two thicknesses farther. `reflectionLevelRead` reads one level at `uv`, weighted by the depth
 * there: level 0, the lit image itself (`reflectionImage`), as the sampler interpolates it, sharp,
 * its coverage held within one; a coarser one (level `k` at its mip `k`)
 * as a cubic B-spline of its texels (four bilinear reads under one weight), smooth, so that a
 * blurred reflection is a round blob at every level, never a texel's square. `reflectionRadianceAt`
 * reads a fractional level between its two.
 */
export const reflectionFootprintWgsl = (group: number) =>
  wgslBlock(
    `reflectionFootprintWgsl(${group})`,
    [reflectionBindingsWgsl(group), REFLECTION_CONE_WGSL, REFLECTION_LOBE_WGSL, clipToFramebuffer],
    `struct ReflectionTaps{color:vec4f,weight:f32,}
struct ReflectionSurface{pixel:vec2f,plane:vec3f,thickness:f32,}
struct ReflectionCone{short:f32,long:f32,level:f32,}
fn reflectionConeAt(distance:f32,pixel:f32,lobe:ReflectionLobe)->ReflectionCone{
 let reach=2.0*distance/max(pixel,1e-30);
 let short=max(reach*lobe.tangents.x,1.0);
 let long=max(reach*lobe.tangents.y,short);
 return ReflectionCone(short,long,log2(max(short,long/REFLECTION_TAPS)));
}
fn reflectionDepthWeight(X:vec2f,surface:ReflectionSurface)->f32{
 let z=hizFrontDepth(vec2i(floor(X)));
 let along=dot(X-surface.pixel,surface.plane.yz);
 let apart=max(abs(z-surface.plane.x-along)-surface.thickness-abs(along),0.0);
 return 1.0-smoothstep(0.0,2.0*surface.thickness,apart);
}
fn reflectionLevelColor(uv:vec2f,level:f32)->vec4f{
 if(level==0.0){
  let lit=textureSampleLevel(reflectionImage,reflectionSampler,uv,0.0);
  return vec4f(lit.rgb,clamp(lit.a,0.0,1.0));
 }
 let size=vec2f(textureDimensions(reflectionImage,u32(level)));
 let t=uv*size-vec2f(0.5);let i=floor(t);let f=t-i;
 let f2=f*f;let f3=f2*f;let e=vec2f(1.0)-f;
 let w0=e*e*e/6.0;let w1=(vec2f(4.0)-6.0*f2+3.0*f3)/6.0;let w3=f3/6.0;let w2=vec2f(1.0)-w0-w1-w3;
 let g0=w0+w1;let g1=w2+w3;
 let low=(i-vec2f(0.5)+w1/g0)/size;let high=(i+vec2f(1.5)+w3/g1)/size;
 return g0.x*g0.y*textureSampleLevel(reflectionImage,reflectionSampler,low,level)
  +g1.x*g0.y*textureSampleLevel(reflectionImage,reflectionSampler,vec2f(high.x,low.y),level)
  +g0.x*g1.y*textureSampleLevel(reflectionImage,reflectionSampler,vec2f(low.x,high.y),level)
  +g1.x*g1.y*textureSampleLevel(reflectionImage,reflectionSampler,high,level);
}
fn reflectionLevelRead(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let w=share*reflectionDepthWeight(toView.xy+uv*toView.zw,surface);
 if(w>0.0){
  (*sum).color+=w*reflectionLevelColor(uv,level);
  (*sum).weight+=w;
 }
}
fn reflectionRadianceAt(sum:ptr<function,ReflectionTaps>,uv:vec2f,level:f32,share:f32,toView:vec4f,surface:ReflectionSurface){
 let below=floor(level);
 let f=level-below;
 reflectionLevelRead(sum,uv,below,share*(1.0-f),toView,surface);
 if(f>0.0){reflectionLevelRead(sum,uv,below+1.0,share*f,toView,surface);}
}
fn reflectionFootprint(Q:vec2f,hit:vec3f,pixel:f32,lobe:ReflectionLobe,cone:ReflectionCone,toView:vec4f,surface:ReflectionSurface)->ReflectionTaps{
 let taps=min(ceil(cone.long/cone.short),REFLECTION_TAPS);
 let level=min(cone.level,reflectionView.radiance.z);
 let texel=1.0/vec2f(textureDimensions(reflectionImage));
 var sum=ReflectionTaps(vec4f(0.0),0.0);
 if(taps<2.0){
  reflectionRadianceAt(&sum,Q*texel,level,1.0,toView,surface);
  return sum;
 }
 let toward=clipToFramebuffer(reflectionView.radianceViewProj*vec4f(hit+lobe.T*pixel,1.0),reflectionView.radiance.xy).xy-Q;
 let span=(cone.long-exp2(cone.level))*toward*inverseSqrt(max(dot(toward,toward),1e-30));
 for(var k=0.0;k<taps;k+=1.0){
  reflectionRadianceAt(&sum,(Q+span*((k+0.5)/taps-0.5))*texel,level,1.0,toView,surface);
 }
 return sum;
}`,
  )
