import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'

/**
 * WHAT THE SURFACES MOVE BY, from the vectors the velocity stage drew for this image (`sceneVectors` at `binding`, one
 * word a render texel, `decodeVector`): a vector is the device position of a texel less where its surface stood in the
 * image before, the camera's motion with the surface's own. `spMotionOf` reads it at `pixel`, the surface at the world
 * point `P`: its world displacement `speed` — its point in the view-projection of the last lit image (the camera's own
 * motion, which depth it keeps) with the device position the vector names, taken back through that view-projection's
 * inverse (`sp.previous`) — and `ndc`, where that surface stood: through the vector where it moves faster than
 * `sp.motion.x` of its depth, else where the camera alone puts it (`camera`, the device position of `P` in the last
 * view-projection), the exact reprojection of a still surface. A program that reads no vector (`SP_FLAG_VELOCITY` down)
 * has none: its surfaces are still.
 */
export const spVectors = (binding: number) =>
  wgslBlock(
    `spVectors(${binding})`,
    [VECTOR_CODEC_WGSL, pixelToNdc],
    `@group(0) @binding(${binding}) var sceneVectors:texture_2d<u32>;
struct SpMotion{ndc:vec2f,speed:f32,}
fn spVectorNdc(pixel:vec2i)->vec2f{
 let last=vec2i(sp.size.xy)-vec2i(1);
 return pixelToNdc(vec2f(pixel)+vec2f(0.5),vec2f(sp.size.xy))-decodeVector(textureLoad(sceneVectors,clamp(pixel,vec2i(0),last),0).r);
}
fn spMotionOf(pixel:vec2i,P:vec3f,camera:vec2f)->SpMotion{
 if(!spFlag(SP_FLAG_VELOCITY)){return SpMotion(camera,0.0);}
 let vector=spVectorNdc(pixel);
 let prev=reflectionView.radianceViewProj*vec4f(P,1.0);
 var speed=0.0;
 if(prev.w>0.0){
  let at=sp.previous*vec4f(vector*prev.w,prev.z,prev.w);
  speed=length(P-at.xyz/at.w);
 }
 return SpMotion(select(vector,camera,speed<=sp.motion.x*max(spDepthOf(P),1.0)),speed);
}`,
  )
