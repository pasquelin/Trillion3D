import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'

/**
 * WHERE A SURFACE STOOD IN THE IMAGE BEFORE, from the word the velocity stage drew for it (`decodeVector`): a vector
 * is the device position of a texel less where its surface stood, the camera's motion with the surface's own, and
 * the word says whether the surface moved by itself (`hasOwnMotion`: a dynamic pixel). A dynamic pixel's surface
 * stood at its own position `here` less the vector; any other where the camera alone puts it (`camera`, the device
 * position of its point in the last view-projection), the exact reprojection of a still surface. The one reading of
 * the vectors every pass that reprojects a surface's history shares.
 */
export const SURFACE_PAST_WGSL = wgslBlock(
  'SURFACE_PAST_WGSL',
  [VECTOR_CODEC_WGSL],
  `fn surfacePast(word:u32,here:vec2f,camera:vec2f)->vec2f{
 if(!hasOwnMotion(word)){return camera;}
 return here-decodeVector(word);
}`,
)

/**
 * WHAT THE SURFACES MOVE BY, from the vectors the velocity stage drew for this image (`sceneVectors` at `binding`, two
 * words a render texel). `spMotionOf` reads it at `pixel`, the surface at the world point `P`: `ndc`, where that surface
 * stood, `before`, the world point it stood at, and its world displacement `speed`. A dynamic pixel stood at the device
 * position its vector names, at the device depth its depth step gives (`depthStepOf`, the reference's velocity depth), taken
 * back through the last lit image's view-projection inverse (`sp.previous`); a still one stood where it is. A program that
 * reads no vector (`SP_FLAG_VELOCITY` down) has none: its surfaces are still. `spStoodClip` is the clip position of the point, in the
 * last lit image's view-projection, that the surface stood at (the depth the last image kept it at): the point's own `clip` for a
 * surface that did not move by itself, the position it stood at (`before`) for one that did.
 */
export const spVectors = (binding: number) =>
  wgslBlock(
    `spVectors(${binding})`,
    [SURFACE_PAST_WGSL, VECTOR_CODEC_WGSL, pixelToNdc],
    `@group(0) @binding(${binding}) var sceneVectors:texture_2d<u32>;
struct SpMotion{ndc:vec2f,speed:f32,before:vec3f,}
fn spMotionOf(pixel:vec2i,P:vec3f,camera:vec2f)->SpMotion{
 if(!spFlag(SP_FLAG_VELOCITY)){return SpMotion(camera,0.0,P);}
 let last=vec2i(sp.size.xy)-vec2i(1);
 let words=textureLoad(sceneVectors,clamp(pixel,vec2i(0),last),0);
 if(!hasOwnMotion(words.r)){return SpMotion(camera,0.0,P);}
 // A dynamic pixel stood at its own position less its vector, at its depth less its depth step.
 let vector=surfacePast(words.r,pixelToNdc(vec2f(pixel)+vec2f(0.5),vec2f(sp.size.xy)),camera);
 let now=reflectionView.viewProj*vec4f(P,1.0);
 if(now.w<=0.0){return SpMotion(vector,0.0,P);}
 let at=sp.previous*vec4f(vector,now.z/now.w-depthStepOf(words.g),1.0);
 let before=at.xyz/at.w;
 return SpMotion(vector,length(P-before),before);
}
fn spStoodClip(motion:SpMotion,P:vec3f,clip:vec4f)->vec4f{
 if(all(motion.before==P)){return clip;}
 return reflectionView.radianceViewProj*vec4f(motion.before,1.0);
}`,
  )
