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
 * WHAT THE SURFACES MOVE BY, from the vectors the velocity stage drew for this image (`sceneVectors` at `binding`, one
 * word a render texel). `spMotionOf` reads it at `pixel`, the surface at the world point `P`: `ndc`, where that surface
 * stood, and its world displacement `speed`, of a dynamic pixel: its point in the view-projection of
 * the last lit image (the camera's own motion, which depth it keeps) with the device position the vector names, taken
 * back through that view-projection's inverse (`sp.previous`); zero for a still one. A program that reads no vector
 * (`SP_FLAG_VELOCITY` down) has none: its surfaces are still.
 */
export const spVectors = (binding: number) =>
  wgslBlock(
    `spVectors(${binding})`,
    [VECTOR_CODEC_WGSL, pixelToNdc],
    `@group(0) @binding(${binding}) var sceneVectors:texture_2d<u32>;
struct SpMotion{ndc:vec2f,speed:f32,}
fn spMotionOf(pixel:vec2i,P:vec3f,camera:vec2f)->SpMotion{
 if(!spFlag(SP_FLAG_VELOCITY)){return SpMotion(camera,0.0);}
 let last=vec2i(sp.size.xy)-vec2i(1);
 let word=textureLoad(sceneVectors,clamp(pixel,vec2i(0),last),0).r;
 if(!hasOwnMotion(word)){return SpMotion(camera,0.0);}
 // A dynamic pixel stood at its own position less its vector, as surfacePast says.
 let vector=pixelToNdc(vec2f(pixel)+vec2f(0.5),vec2f(sp.size.xy))-decodeVector(word);
 let prev=reflectionView.radianceViewProj*vec4f(P,1.0);
 var speed=0.0;
 if(prev.w>0.0){
  let at=sp.previous*vec4f(vector*prev.w,prev.z,prev.w);
  speed=length(P-at.xyz/at.w);
 }
 return SpMotion(vector,speed);
}`,
  )
